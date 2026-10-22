"""compare_sellers: up to three sellers of one product side by side."""

from datetime import datetime, timedelta
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field, model_validator

from pasazhgard.compare import get_product
from pasazhgard.inquiries import outcomes
from pasazhgard.normalize import distinct
from pasazhgard.routing import TravelMode, straight_line
from pasazhgard.sellers import SellerRow, _distance, _row, seller_offers
from pasazhgard.shops import TEHRAN, open_at


class CompareQuery(BaseModel):
    offer_id: Annotated[list[str], Field(min_length=1, max_length=3), AfterValidator(distinct)]
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    mode: TravelMode = "walk"
    # the visit time; without it each seller is reached at now + its travel time
    arrival: AwareDatetime | None = None
    # the session whose inquiries fill `latest_price` and `inquiry`
    session_id: str | None = None

    @model_validator(mode="after")
    def _origin(self) -> Self:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon go together")
        return self


class SellerColumn(SellerRow):
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
    # shortcut: straight-line estimate for up to three sellers; the visit plan uses the routing port.
    # Move here too if compare times and plan times disagree visibly
    product = get_product(conn, product_id)
    if product is None:
        return None
    by_id = {o["offer_id"]: o for o in seller_offers(conn, product_id) if o["offer_id"] in q.offer_id}
    if len(by_id) != len(q.offer_id):
        return None
    asked = outcomes(conn, q.session_id, product_id, now) if q.session_id else {}
    cols = []
    for oid in q.offer_id:
        o = by_id[oid]
        d = _distance(q, o)
        travel = None if d is None else straight_line((q.lat, q.lon), (o["lat"], o["lon"]), q.mode).duration_min
        at = (q.arrival or now + timedelta(minutes=travel or 0)).astimezone(TEHRAN)
        cols.append(
            SellerColumn(
                **_row(o, d, now, asked.get(o["shop_id"])).model_dump(),
                travel_min=travel,
                arrival_at=at,
                open_at_arrival=open_at(o["hours"], at),
                fast_delivery=o["fast_delivery"],
            )
        )
    return SellerCompare(product_id=product_id, title=product.title, travel_mode=q.mode, sellers=cols)
