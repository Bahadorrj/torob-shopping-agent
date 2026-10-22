"""find_sellers: shops that list a product, filtered by area and ranked by a preset."""

from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

from pasazhgard.normalize import normalize
from pasazhgard.search import PriceAgeBucket, _price_range, _usable
from pasazhgard.shops import open_at


class SellerQuery(BaseModel):
    """Area and ranking for a seller list. The area is one of: radius around the origin, a named area, a pasaj."""

    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    radius_m: int | None = Field(None, gt=0, le=50_000)
    area: str | None = None
    pasaj: str | None = None
    priority: Literal["cheapest", "closest", "most_reliable"] = "cheapest"
    # budget: drops sellers listed above it; unpriced sellers stay. `quantity` is in meters for per-meter offers
    max_per_item_toman: int | None = Field(None, gt=0)
    max_total_toman: int | None = Field(None, gt=0)
    quantity: int = Field(1, gt=0)
    # conditions: a shop that fails one is dropped, a shop whose value is not recorded goes to `ask_them`
    arrival: datetime | None = None
    payment: Literal["any", "cash", "torob_pay", "installment"] = "any"
    provider: str | None = None
    warranty: bool = False
    test_in_presence: bool = False
    fast_delivery: bool = False

    @model_validator(mode="after")
    def _one_area(self) -> Self:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon go together")
        if self.radius_m is not None and self.lat is None:
            raise ValueError("radius_m needs an origin")
        if sum(x is not None for x in (self.radius_m, self.area, self.pasaj)) > 1:
            raise ValueError("pick one of radius_m, area, pasaj")
        return self


class Warranty(BaseModel):
    kind: Literal["warranty", "test_in_presence", "none"]
    provider: str | None
    months: int | None
    description: str | None


class PaymentOption(BaseModel):
    provider: str
    channel: Literal["in_person", "unknown"]


class Reason(BaseModel):
    """A score part shown as a chip. `months` is set for warranty, `provider` for installments."""

    kind: Literal["closest", "cheapest", "open_now", "warranty", "fresh_price", "declared_hours", "installments"]
    months: int | None = None
    provider: str | None = None


class SellerRow(BaseModel):
    offer_id: str
    shop_id: str
    shop_name: str
    area: str | None
    pasaj: str | None
    floor: str | None
    unit: str | None
    distance_m: int | None
    price_toman: int | None
    per_meter: bool
    price_age_days: int | None
    price_age_bucket: PriceAgeBucket | None
    trust_level: Literal["listed", "unknown"]
    warranty: Warranty | None
    declared_hours: bool
    # None when today's hours are not recorded
    open_now: bool | None
    # installment providers the shop declared, with the channel it declared
    payment_options: list[PaymentOption]
    reasons: list[Reason]
    # active conditions this shop has no recorded value for; set only in `ask_them`
    unknown: list[Literal["hours", "payment", "warranty", "test_in_presence", "fast_delivery"]] = []


class CategoryShop(BaseModel):
    """A shop whose activity category matches but that does not list the product."""

    shop_id: str
    shop_name: str
    area: str | None
    pasaj: str | None
    distance_m: int | None
    trust_level: Literal["category_only"] = "category_only"


class NearestCovered(BaseModel):
    """Where the nearest seller outside an empty area is. `distance_m` is unknown when the empty area has no location."""

    area: str | None
    pasaj: str | None
    distance_m: int | None


class SellerList(BaseModel):
    product_id: str
    title: str
    count: int
    sellers: list[SellerRow]
    ask_them: list[SellerRow]
    category_only: list[CategoryShop]
    nearest_covered: NearestCovered | None
    areas: list[str]
    pasajs: list[str]


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    """Great-circle distance."""
    a = sin(radians(lat2 - lat1) / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ** 2
    return round(2 * 6_371_000 * asin(sqrt(a)))


def _distance(q: SellerQuery, shop: dict) -> int | None:
    if q.lat is None or shop["lat"] is None:
        return None
    return distance_m(q.lat, q.lon, shop["lat"], shop["lon"])


def _in_area(q: SellerQuery, shop: dict, distance: int | None) -> bool:
    if q.radius_m is not None:
        return distance is not None and distance <= q.radius_m
    if q.area is not None:
        return shop["location_label"] == q.area
    if q.pasaj is not None:
        return shop["pasaj"] == q.pasaj
    return True


def _row(offer: dict, distance: int | None, now: datetime) -> SellerRow:
    price = _price_range([offer], now)
    return SellerRow(
        offer_id=offer["offer_id"],
        shop_id=offer["shop_id"],
        shop_name=offer["name"],
        area=offer["location_label"],
        **{k: offer[k] for k in ("pasaj", "floor", "unit")},
        distance_m=distance,
        price_toman=price.min_toman,
        per_meter=price.per_meter,
        price_age_days=price.price_age_days,
        price_age_bucket=price.price_age_bucket,
        trust_level=price.trust_level,
        warranty=offer["warranty"],
        declared_hours=any(d["status"] == "declared" for d in offer["hours"].values()),
        open_now=open_at(offer["hours"], now),
        payment_options=offer["payment_options"],
        reasons=[],
    )


def _conditions(q: SellerQuery, offer: dict) -> dict[str, bool | None]:
    """The active conditions: True met, False not met, None not recorded."""
    met = {}
    if q.arrival:
        met["hours"] = open_at(offer["hours"], q.arrival)
    # a provider missing from the shop's list is not a no: the list is sparse, so ask
    options = offer["payment_options"]
    if q.payment == "installment":
        met["payment"] = any(_same_provider(p["provider"], q.provider) for p in options) or None
    elif q.payment == "torob_pay":
        met["payment"] = any(_same_provider(p["provider"], "ترب‌پی") and p["channel"] == "in_person" for p in options) or None
    w = offer["warranty"] or {}
    if q.warranty:
        # a warranty without a term is often noise ("تایید اصالت"), so only a term counts as one
        met["warranty"] = False if w.get("kind") == "none" else bool(w.get("months")) or None
    if q.test_in_presence:
        met["test_in_presence"] = w.get("kind") == "test_in_presence" or None
    if q.fast_delivery:
        met["fast_delivery"] = {"yes": True, "no": False}.get(offer["fast_delivery"])
    return met


def _over_budget(q: SellerQuery, price: int | None) -> bool:
    if price is None:
        return False
    return bool(q.max_per_item_toman and price > q.max_per_item_toman or q.max_total_toman and price * q.quantity > q.max_total_toman)


def _same_provider(name: str, asked: str | None) -> bool:
    """None asks for any provider; spacing in the name does not matter ("دیجی پی", "دیجی‌پی")."""
    return asked is None or normalize(name).replace(" ", "") == normalize(asked).replace(" ", "")


def _reliability(r: SellerRow) -> int:
    fresh = {"<=7": 2, "8-30": 1}.get(r.price_age_bucket, 0)
    return fresh + bool(r.warranty and r.warranty.months) + r.declared_hours


def _rank(rows: list[SellerRow], priority: str) -> None:
    def by_price(r):
        # a meter price is not comparable with a piece price, so per-piece offers rank first
        return (r.price_toman is None, r.per_meter, r.price_toman or 0, r.shop_id)

    if priority == "closest":
        rows.sort(key=lambda r: (r.distance_m is None, r.distance_m or 0, *by_price(r)))
    elif priority == "most_reliable":
        rows.sort(key=lambda r: (-_reliability(r), *by_price(r)))
    else:
        rows.sort(key=by_price)


def _add_reasons(rows: list[SellerRow], provider: str | None) -> None:
    priced = [r for r in rows if r.price_toman is not None]
    # "cheapest" compares one unit: per-piece prices, or per-meter ones when no seller prices a piece
    unit = all(r.per_meter for r in priced)
    prices = [r.price_toman for r in priced if r.per_meter == unit]
    distances = [r.distance_m for r in rows if r.distance_m is not None]
    for r in rows:
        # "closest" and "cheapest" compare sellers, so a lone seller does not get them
        if len(distances) > 1 and r.distance_m == min(distances):
            r.reasons.append(Reason(kind="closest"))
        if len(prices) > 1 and r.per_meter == unit and r.price_toman == min(prices):
            r.reasons.append(Reason(kind="cheapest"))
        if r.open_now:
            r.reasons.append(Reason(kind="open_now"))
        # a warranty without a term is often noise ("ندارد", "تایید اصالت"), so only a term counts
        if r.warranty and r.warranty.months:
            r.reasons.append(Reason(kind="warranty", months=r.warranty.months))
        if r.price_age_bucket == "<=7":
            r.reasons.append(Reason(kind="fresh_price"))
        if r.declared_hours:
            r.reasons.append(Reason(kind="declared_hours"))
        # the asked provider, else the first one the shop declared
        if r.payment_options:
            names = [p.provider for p in r.payment_options]
            r.reasons.append(Reason(kind="installments", provider=next((n for n in names if _same_provider(n, provider)), names[0])))


def _nearest_covered(conn, q: SellerQuery, sellers: list[dict]) -> NearestCovered | None:
    if not sellers:
        return None
    if q.lat is not None:
        ref = (q.lat, q.lon)
    else:
        ref = conn.execute(
            "SELECT avg(lat) AS lat, avg(lon) AS lon FROM shops WHERE location_label = %s OR pasaj = %s",
            [q.area, q.pasaj],
        ).fetchone()
        ref = (ref["lat"], ref["lon"]) if ref["lat"] is not None else None
    located = [s for s in sellers if s["lat"] is not None]
    if ref is None or not located:
        # shortcut: no location to measure from, so suggest the first seller's area; fine while areas are few
        s = sorted(sellers, key=lambda s: s["shop_id"])[0]
        return NearestCovered(area=s["location_label"], pasaj=s["pasaj"], distance_m=None)
    d, s = min(((distance_m(*ref, s["lat"], s["lon"]), s) for s in located), key=lambda x: x[0])
    return NearestCovered(area=s["location_label"], pasaj=s["pasaj"], distance_m=d)


def area_options(conn) -> dict[str, list[str]]:
    """Every covered area and pasaj, so the picker can also land on one without sellers."""
    row = conn.execute("SELECT array_agg(DISTINCT location_label) AS areas, array_agg(DISTINCT pasaj) AS pasajs FROM shops").fetchone()
    return {k: sorted(v for v in row[k] or [] if v) for k in ("areas", "pasajs")}


def find_sellers(conn, product_id: str, q: SellerQuery, now: datetime) -> SellerList | None:
    product = conn.execute("SELECT product_id, title, category FROM products WHERE product_id = %s", [product_id]).fetchone()
    if product is None:
        return None
    offers = conn.execute(
        """
        SELECT o.*, s.name, s.location_label, s.pasaj, s.floor, s.unit, s.lat, s.lon, s.hours, s.payment_options, s.fast_delivery
        FROM offers o JOIN shops s USING (shop_id)
        WHERE o.product_id = %s
        """,
        [product_id],
    ).fetchall()
    # one row per shop: its cheapest usable offer, else any offer
    best = {}
    for o in sorted(offers, key=lambda o: (not _usable([o]), o["price_toman"] or 0, o["offer_id"])):
        best.setdefault(o["shop_id"], o)
    rows, ask_them, in_area = [], [], False
    for o in best.values():
        d = _distance(q, o)
        if not _in_area(q, o, d):
            continue
        in_area = True
        row = _row(o, d, now)
        met = _conditions(q, o)
        if False in met.values():
            continue
        if _over_budget(q, row.price_toman):
            continue
        row.unknown = [k for k, v in met.items() if v is None]
        (ask_them if row.unknown else rows).append(row)
    _rank(rows, q.priority)
    _rank(ask_them, q.priority)
    category_only = []
    for s in conn.execute(
        """
        SELECT shop_id, name, location_label, pasaj, lat, lon FROM shops
        WHERE %s = ANY(categories) AND shop_id NOT IN (SELECT shop_id FROM offers WHERE product_id = %s)
        """,
        [product["category"], product_id],
    ):
        d = _distance(q, s)
        if _in_area(q, s, d):
            category_only.append(
                CategoryShop(shop_id=s["shop_id"], shop_name=s["name"], area=s["location_label"], pasaj=s["pasaj"], distance_m=d)
            )
    category_only.sort(key=lambda c: (c.distance_m is None, c.distance_m or 0, c.shop_name))
    _add_reasons(rows, q.provider)
    _add_reasons(ask_them, q.provider)
    return SellerList(
        product_id=product_id,
        title=product["title"],
        count=len(rows),
        sellers=rows,
        ask_them=ask_them,
        category_only=category_only,
        # only an area without sellers suggests another; a filter that empties the list does not
        nearest_covered=None if in_area else _nearest_covered(conn, q, list(best.values())),
        **area_options(conn),
    )
