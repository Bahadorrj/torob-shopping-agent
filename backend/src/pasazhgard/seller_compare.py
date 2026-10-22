"""compare_sellers: up to three sellers of one product side by side."""

from datetime import datetime, timedelta
from math import ceil
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field, model_validator

from pasazhgard.compare import get_product
from pasazhgard.sellers import SellerRow, _distance, _row, distinct, seller_offers
from pasazhgard.shops import TEHRAN, open_at

TravelMode = Literal["walk", "transit", "car"]


class CompareQuery(BaseModel):
    offer_id: Annotated[list[str], Field(min_length=1, max_length=3), AfterValidator(distinct)]
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    mode: TravelMode = "walk"
    # the visit time; without it each seller is reached at now + its travel time
    arrival: AwareDatetime | None = None

    @model_validator(mode="after")
    def _origin(self) -> Self:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon go together")
        return self


class LatestPrice(BaseModel):
    """A price newer than the listing: one a seller confirmed or a website showed."""

    # shortcut: always not_asked; the Seller Liaison and fetch_site_price fill it once they exist
    status: Literal["not_asked"] = "not_asked"
    price_toman: int | None = None
    trust_level: Literal["unknown"] = "unknown"
    at: datetime | None = None


class SellerColumn(SellerRow):
    latest_price: LatestPrice = LatestPrice()
    travel_min: int | None
    arrival_at: datetime
    # None when the shop's hours for that day are not recorded
    open_at_arrival: bool | None
    fast_delivery: Literal["yes", "no", "unknown"]


class SellerCompare(BaseModel):
    product_id: str
    title: str
    travel_mode: TravelMode
    travel_estimate: Literal["straight_line"] = "straight_line"
    sellers: list[SellerColumn]


def compare_sellers(conn, product_id: str, q: CompareQuery, now: datetime) -> SellerCompare | None:
    """None when the product is missing or an offer is not one of its offers."""
    # shortcut: straight-line distance at a flat speed per mode ignores streets and traffic,
    # replace with the routing port when travel times drive the visit plan
    kmh = {"walk": 4.5, "transit": 15, "car": 20}
    product = get_product(conn, product_id)
    if product is None:
        return None
    by_id = {o["offer_id"]: o for o in seller_offers(conn, product_id) if o["offer_id"] in q.offer_id}
    if len(by_id) != len(q.offer_id):
        return None
    cols = []
    for oid in q.offer_id:
        o = by_id[oid]
        d = _distance(q, o)
        travel = None if d is None else ceil(d / (kmh[q.mode] * 1000 / 60))
        at = (q.arrival or now + timedelta(minutes=travel or 0)).astimezone(TEHRAN)
        cols.append(
            SellerColumn(
                **_row(o, d, now).model_dump(),
                travel_min=travel,
                arrival_at=at,
                open_at_arrival=open_at(o["hours"], at),
                fast_delivery=o["fast_delivery"],
            )
        )
    return SellerCompare(product_id=product_id, title=product.title, travel_mode=q.mode, sellers=cols)
