"""shop_details: everything a user needs before going to a shop."""

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from pasazhgard.clean import WEEK

Day = Literal["sat", "sun", "mon", "tue", "wed", "thu", "fri"]


class Shift(BaseModel):
    start: str
    end: str


class DayHours(BaseModel):
    day: Day
    status: Literal["declared", "closed", "unsupported", "unknown"]
    shifts: list[Shift]


class Hours(BaseModel):
    timezone: Literal["Asia/Tehran"]
    today: Day
    week: list[DayHours]


class PaymentOption(BaseModel):
    provider: str
    channel: Literal["in_person", "unknown"]


class ShopDetails(BaseModel):
    shop_id: str
    name: str
    address: str | None
    pasaj: str | None
    floor: str | None
    unit: str | None
    landmark: str | None
    hours: Hours
    payment_options: list[PaymentOption]
    fast_delivery: Literal["yes", "no", "unknown"]
    website_url: str | None
    instagram_url: str | None


def shop_details(conn, shop_id: str, now: datetime) -> ShopDetails | None:
    shop = conn.execute("SELECT * FROM shops WHERE shop_id = %s", [shop_id]).fetchone()
    if shop is None:
        return None
    tz = "Asia/Tehran"
    return ShopDetails(
        **{k: shop[k] for k in ShopDetails.model_fields if k != "hours"},
        hours=Hours(
            timezone=tz,
            today=WEEK[(now.astimezone(ZoneInfo(tz)).weekday() + 2) % 7],
            week=[DayHours(day=d, **shop["hours"][d]) for d in WEEK],
        ),
    )
