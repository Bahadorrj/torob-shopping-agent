"""plan_visit and get_directions: getting from the origin to the shops, down to floor and unit."""

from datetime import datetime, time, timedelta
from itertools import permutations
from typing import Annotated, Literal, get_args

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field

from pasazhgard.alternatives import Reason
from pasazhgard.brief import Brief, Point, seller_query
from pasazhgard.clean import weekday_key
from pasazhgard.inquiries import Outcome, get_inquiries, latest_price, outcome
from pasazhgard.normalize import distinct
from pasazhgard.pasaj import floor_level
from pasazhgard.routing import LatLon, Route, Router, TravelMode, straight_line
from pasazhgard.sellers import _over_budget, distance_m, find_sellers
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


class Swap(BaseModel):
    """Another seller of the stop's item, open when you would get there."""

    shop_id: str
    shop_name: str
    offer_id: str
    price_toman: int | None
    distance_m: int | None


class ClosingNudge(BaseModel):
    """A stop that closes between leaving (now, or the planned departure if later) and arriving."""

    kind: Literal["closing"] = "closing"
    shop_id: str
    shop_name: str
    closes_at: datetime
    # leaving later arrives at or after closing
    leave_by: datetime
    # None when the stop has no inquiry, so no item to look for elsewhere, or no other seller is open
    swap: Swap | None


class PriceNudge(BaseModel):
    """A seller-confirmed or website price that differs from the listed one."""

    kind: Literal["price"] = "price"
    shop_id: str
    shop_name: str
    product_id: str
    product_title: str
    listed_price_toman: int
    latest_price_toman: int
    price_delta_toman: int
    trust_level: Literal["confirmed", "website_price"]
    # the latest price against the brief's budget
    over_budget: bool


class VisitPlan(BaseModel):
    origin: Point
    depart_at: datetime
    mode: TravelMode
    stops: list[Stop]
    nudges: list[Annotated[ClosingNudge | PriceNudge, Field(discriminator="kind")]] = []


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


def _closes_on_the_way(hours: dict, leave: datetime, arrive: datetime) -> datetime | None:
    """The end of a shift of the arrival day that falls after leaving and by arriving."""
    arrive = arrive.astimezone(TEHRAN)
    midnight = datetime.combine(arrive.date(), time(), TEHRAN)
    # shortcut: a shift running past midnight is not read, as in open_at
    for s in sorted(hours[weekday_key(arrive)]["shifts"], key=lambda s: s["end"]):
        h, m = map(int, s["end"].split(":"))
        if leave < (end := midnight + timedelta(hours=h, minutes=m)) <= arrive:
            return end
    return None


def _swap(conn, brief: Brief, product_id: str, shop: dict, at: datetime, planned: set[str]) -> Swap | None:
    """The nearest other seller of the item open at `at`."""
    q = seller_query(brief, product_id, at).model_copy(
        update={"lat": shop["lat"], "lon": shop["lon"], "radius_m": None, "area": None, "pasaj": None, "arrival": None}
    )
    # no session: its inquiries would tick at the arrival time instead of the clock
    found = find_sellers(conn, product_id, q, at)
    rows = [r for r in (found.sellers + found.ask_them if found else []) if r.open_now and r.shop_id not in planned]
    best = min(rows, key=lambda r: (r.distance_m is None, r.distance_m or 0), default=None)
    if best is None:
        return None
    return Swap(shop_id=best.shop_id, shop_name=best.shop_name, offer_id=best.offer_id, price_toman=best.price_toman, distance_m=best.distance_m)


def _closing(conn, stops: list[Stop], shops: dict[str, dict], asked: dict, brief: Brief, depart: datetime, now: datetime) -> list[ClosingNudge]:
    # the trip leaves at the planned time, or now once that has passed
    leave = max(depart, now)
    nudges = []
    for stop in stops:
        offset = stop.eta - depart
        if closes := _closes_on_the_way(shops[stop.shop_id]["hours"], leave, leave + offset):
            i = asked.get(stop.shop_id)
            swap = _swap(conn, brief, i.product_id, shops[stop.shop_id], leave + offset, {s.shop_id for s in stops}) if i else None
            nudges.append(ClosingNudge(shop_id=stop.shop_id, shop_name=stop.shop_name, closes_at=closes, leave_by=closes - offset, swap=swap))
    return nudges


def _price_changes(conn, stops: list[Stop], asked: dict, sites: dict, brief: Brief, now: datetime) -> list[PriceNudge]:
    order = [s.shop_id for s in stops]
    items = {(i.shop_id, i.product_id) for i in asked.values()} | {k for k, p in sites.items() if p.status == "found"}
    items = [k for k in items if k[0] in order]
    if not items:
        return []
    # the shop's cheapest listing of the item
    rows = conn.execute(
        """
        SELECT o.shop_id, o.product_id, p.title, min(o.price_toman) AS price FROM offers o JOIN products p USING (product_id)
        WHERE (o.shop_id, o.product_id) IN (SELECT * FROM unnest(%s::text[], %s::text[])) GROUP BY 1, 2, 3
        """,
        [[k[0] for k in items], [k[1] for k in items]],
    ).fetchall()
    names = {s.shop_id: s.shop_name for s in stops}
    nudges = []
    for r in sorted(rows, key=lambda r: (order.index(r["shop_id"]), r["product_id"])):
        i = asked.get(r["shop_id"])
        latest = latest_price(outcome(i) if i and i.product_id == r["product_id"] else None, sites.get((r["shop_id"], r["product_id"])))
        if latest.price_toman is None or r["price"] is None or latest.price_toman == r["price"]:
            continue
        nudges.append(
            PriceNudge(
                shop_id=r["shop_id"],
                shop_name=names[r["shop_id"]],
                product_id=r["product_id"],
                product_title=r["title"],
                listed_price_toman=r["price"],
                latest_price_toman=latest.price_toman,
                price_delta_toman=latest.price_toman - r["price"],
                trust_level=latest.trust_level,
                over_budget=_over_budget(seller_query(brief, r["product_id"], now), latest.price_toman),
            )
        )
    return nudges


def plan_visit(conn, q: PlanQuery, now: datetime, router: Router) -> VisitPlan | None:
    """None when a shop or the session is not found.

    With a session, each stop carries the shop's latest sent inquiry, a shop whose inquiry fell through gives its
    stop to the alternative asked instead, and shops that confirmed come first.
    """
    dwell = timedelta(minutes=15)
    asked, instead, listed, sites, brief = {}, {}, {}, {}, Brief()
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
        sites = {(p.shop_id, p.product_id): p for p in status.site_prices}

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
    return VisitPlan(
        origin=Point(lat=q.lat, lon=q.lon),
        depart_at=depart,
        mode=q.mode,
        stops=stops,
        nudges=_closing(conn, stops, found, asked, brief, depart, now) + _price_changes(conn, stops, asked, sites, brief, now),
    )
