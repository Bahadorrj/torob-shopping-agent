"""plan_visit and get_directions: getting from the origin to the shops, down to floor and unit."""

import re
from datetime import datetime, timedelta
from itertools import permutations
from typing import Annotated, get_args

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field

from pasazhgard.alternatives import Reason
from pasazhgard.brief import Brief, Point, seller_query
from pasazhgard.inquiries import Outcome, get_inquiries, outcome
from pasazhgard.normalize import distinct, normalize
from pasazhgard.routing import LatLon, Route, Router, TravelMode, straight_line
from pasazhgard.sellers import _over_budget, distance_m
from pasazhgard.shops import TEHRAN, open_at


class DirectionsQuery(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    mode: TravelMode = "walk"


class MapLinks(BaseModel):
    """One-tap turn-by-turn navigation in a map app."""

    neshan: str
    balad: str
    google: str


class LastLeg(BaseModel):
    """Inside the pasaj: what the route to the street address does not cover."""

    pasaj: str | None
    landmark: str | None
    floor: str | None
    unit: str | None


class Directions(BaseModel):
    shop_id: str
    shop_name: str
    lat: float
    lon: float
    route: Route
    links: MapLinks
    last_leg: LastLeg


def map_links(a: LatLon, b: LatLon, mode: TravelMode) -> MapLinks:
    origin, dest = f"{a[0]},{a[1]}", f"{b[0]},{b[1]}"
    google_mode = {"walk": "walking", "transit": "transit", "car": "driving"}[mode]
    return MapLinks(
        # Neshan's web and Android links route by car only
        neshan=f"https://nshn.ir/?origin={origin}&destination={dest}&vehicle=d",
        # Balad has no documented route link, so it opens the shop's point
        balad=f"https://balad.ir/location?latitude={b[0]}&longitude={b[1]}&zoom=18",
        google=f"https://www.google.com/maps/dir/?api=1&origin={origin}&destination={dest}&travelmode={google_mode}",
    )


def _shops(conn, shop_ids: list[str]) -> dict[str, dict]:
    # shortcut: a shop without coordinates counts as not found; every shop in the dataset has them
    rows = conn.execute(
        "SELECT shop_id, name, lat, lon, pasaj, landmark, floor, unit, hours FROM shops WHERE shop_id = ANY(%s) AND lat IS NOT NULL",
        [shop_ids],
    )
    return {s["shop_id"]: s for s in rows}


def _directions(shop: dict, a: LatLon, route: Route, mode: TravelMode) -> Directions:
    b = (shop["lat"], shop["lon"])
    return Directions(
        shop_id=shop["shop_id"],
        shop_name=shop["name"],
        lat=b[0],
        lon=b[1],
        route=route,
        links=map_links(a, b, mode),
        last_leg=LastLeg(**{k: shop[k] for k in LastLeg.model_fields}),
    )


def get_directions(conn, shop_id: str, q: DirectionsQuery, router: Router) -> Directions | None:
    shop = _shops(conn, [shop_id]).get(shop_id)
    if shop is None:
        return None
    a = (q.lat, q.lon)
    return _directions(shop, a, router.route(a, (shop["lat"], shop["lon"]), q.mode), q.mode)


class PlanQuery(DirectionsQuery):
    # brute-force ordering is fine: a plan has at most 6 stops
    shop_id: Annotated[list[str], Field(min_length=1, max_length=6), AfterValidator(distinct)]
    # defaults to now
    depart_at: AwareDatetime | None = None
    # the session whose inquiries the plan follows
    session_id: str | None = None


class StopInquiry(Outcome):
    """The shop's latest sent inquiry in the session."""

    product_id: str
    product_title: str
    # None for a shop asked about an item it does not list
    listed_price_toman: int | None
    # the seller's price minus the listed one; None until both are known
    price_delta_toman: int | None
    # the seller's price, else the listed one, against the brief's budget; False while no price is known
    over_budget: bool


class Stop(Directions):
    """`route` is the leg from the previous stop, or from the origin for the first one."""

    eta: datetime
    # None when the shop's hours for that day are not recorded
    open_at_eta: bool | None
    inquiry: StopInquiry | None = None


class VisitPlan(BaseModel):
    origin: Point
    depart_at: datetime
    mode: TravelMode
    stops: list[Stop]


def floor_level(floor: str | None) -> int | None:
    """A floor text as a number for ordering: basement -1, ground 0, then up; None when unreadable."""
    if not floor:
        return None
    f = normalize(floor).replace(" ", "")
    digits = re.search(r"\d+", f)
    words = {"اول": 1, "یک": 1, "دو": 2, "سوم": 3, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6, "هفت": 7, "هشت": 8, "نهم": 9, "دهم": 10}
    n = int(digits[0]) if digits else next((v for w, v in words.items() if w in f), None)
    if "زیر" in f or "منفی" in f or "-" in f:
        return -(n or 1)
    if n is not None:
        return n
    if "همکف" in f:
        return 1 if "بالا" in f else 0
    return None


def _order(origin: LatLon, shops: list[dict]) -> list[dict]:
    """Shortest trip over pasajs by brute force, each pasaj's shops together, bottom floor first."""
    groups: dict[str, list[dict]] = {}
    for s in shops:
        groups.setdefault(s["pasaj"] or s["shop_id"], []).append(s)
    for g in groups.values():
        g.sort(key=lambda s: (floor_level(s["floor"]) is None, floor_level(s["floor"]) or 0, s["shop_id"]))

    def at(g):
        return (sum(s["lat"] for s in g) / len(g), sum(s["lon"] for s in g) / len(g))

    def trip(order):
        points = [origin, *map(at, order)]
        return sum(distance_m(*a, *b) for a, b in zip(points, points[1:]))

    # shortcut: orders by straight-line distance, so the provider is called once per leg of the chosen order
    best = min(permutations(groups.values()), key=trip)
    return [s for g in best for s in g]


def plan_visit(conn, q: PlanQuery, now: datetime, router: Router) -> VisitPlan | None:
    """None when a shop or the session is not found.

    With a session, each stop carries the shop's latest sent inquiry, a shop whose inquiry fell through gives its
    stop to the alternative asked instead, and shops that confirmed come first.
    """
    dwell = timedelta(minutes=15)
    asked, instead, listed = {}, {}, {}
    if q.session_id:
        status = get_inquiries(conn, q.session_id, now)
        if status is None:
            return None
        brief = Brief.model_validate(conn.execute("SELECT brief FROM sessions WHERE session_id = %s", [q.session_id]).fetchone()["brief"])
        sent = [i for i in status.inquiries if i.status != "draft"]
        rows = conn.execute("SELECT offer_id, price_toman FROM offers WHERE offer_id = ANY(%s)", [[i.offer_id for i in sent]])
        listed = {r["offer_id"]: r["price_toman"] for r in rows}
        # oldest first, so a shop's latest inquiry wins
        asked = {i.shop_id: i for i in sent}
        instead = {i.instead_of: i for i in sent if i.instead_of}

    def stand_in(shop_id: str) -> str:
        # each step moves to a newer inquiry, so the walk ends
        while (i := asked.get(shop_id)) and i.status in get_args(Reason) and i.inquiry_id in instead:
            shop_id = instead[i.inquiry_id].shop_id
        return shop_id

    shop_ids = list(dict.fromkeys(map(stand_in, q.shop_id)))
    found = _shops(conn, shop_ids)
    if len(found) != len(shop_ids):
        return None
    depart = (q.depart_at or now).astimezone(TEHRAN)
    here = origin = (q.lat, q.lon)
    prev, eta = None, depart
    stops = []
    confirmed = _order(origin, [s for s in found.values() if s["shop_id"] in asked and asked[s["shop_id"]].status == "confirmed"])
    after = (confirmed[-1]["lat"], confirmed[-1]["lon"]) if confirmed else origin
    for s in confirmed + _order(after, [s for s in found.values() if s not in confirmed]):
        b = (s["lat"], s["lon"])
        # inside one pasaj you walk, whatever the travel mode
        same_pasaj = prev is not None and s["pasaj"] and s["pasaj"] == prev["pasaj"]
        leg = straight_line(here, b, "walk") if same_pasaj else router.route(here, b, q.mode)
        eta = eta + (dwell if prev else timedelta()) + timedelta(minutes=leg.duration_min)
        inquiry = None
        if i := asked.get(s["shop_id"]):
            o, price = outcome(i), listed.get(i.offer_id)
            inquiry = StopInquiry(
                **o.model_dump(),
                product_id=i.product_id,
                product_title=i.product_title,
                listed_price_toman=price,
                price_delta_toman=o.latest_price_toman - price if o.latest_price_toman and price else None,
                over_budget=_over_budget(seller_query(brief, i.product_id, now), o.latest_price_toman or price),
            )
        stops.append(Stop(**_directions(s, here, leg, q.mode).model_dump(), eta=eta, open_at_eta=open_at(s["hours"], eta), inquiry=inquiry))
        here, prev = b, s
    return VisitPlan(origin=Point(lat=q.lat, lon=q.lon), depart_at=depart, mode=q.mode, stops=stops)
