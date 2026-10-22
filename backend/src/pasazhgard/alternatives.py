"""find_alternatives: where else to ask when an inquiry falls through (PRD F6, F7)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel

from pasazhgard.brief import Brief, seller_query
from pasazhgard.inquiries import _fa, get_inquiries, outcomes
from pasazhgard.sellers import SellerRow, find_sellers

Reason = Literal["unavailable", "no_reply", "closed"]


class Alternative(BaseModel):
    kind: Literal["same_product"]
    offer_id: str
    product_id: str
    product_title: str
    shop_id: str
    shop_name: str
    pasaj: str | None
    # the seller's confirmed price, else the listed one
    price_toman: int | None
    # against the price of the inquiry that fell through; None when either is unknown
    price_delta_toman: int | None
    same_pasaj: bool
    open_now: bool | None
    # from the shop that fell through, else from the brief's origin
    distance_m: int | None
    # one line built from the fields above
    tradeoff: str


class Alternatives(BaseModel):
    """The `alternatives` block: the top 2 places to ask instead, in PRD F6 order."""

    inquiry_id: int
    reason: Reason
    alternatives: list[Alternative]


def _toman(n: int) -> str:
    if n < 1_000_000:
        return f"{_fa(str(round(n / 1000)))} هزار تومان"
    return f"{_fa(f'{n / 1_000_000:.1f}'.removesuffix('.0')).replace('.', '٫')} میلیون تومان"


def _tradeoff(a: Alternative) -> str:
    parts = []
    if (d := a.price_delta_toman) is not None:
        parts.append("هم‌قیمت" if d == 0 else f"{_toman(abs(d))} {'گران‌تر' if d > 0 else 'ارزان‌تر'}")
    if a.same_pasaj:
        parts.append("همین پاساژ")
    elif a.distance_m is not None:
        parts.append(f"{_fa(str(a.distance_m))} متر فاصله" if a.distance_m < 1000 else f"{_fa(f'{a.distance_m / 1000:.1f}').replace('.', '٫')} کیلومتر فاصله")
    if a.open_now:
        parts.append("الان باز است")
    return "، ".join(parts)


def find_alternatives(conn, sid: str, inquiry_id: int, now: dt.datetime) -> Alternatives | None:
    """None when the session has no such inquiry; ValueError when the inquiry has not fallen through."""
    status = get_inquiries(conn, sid, now)
    inquiry = next((i for i in status.inquiries if i.inquiry_id == inquiry_id), None) if status else None
    if inquiry is None:
        return None
    if inquiry.status not in Reason.__args__:
        raise ValueError(inquiry.status)
    brief = Brief.model_validate(conn.execute("SELECT brief FROM sessions WHERE session_id = %s", [sid]).fetchone()["brief"])
    # the shop may be gone after a re-ingest; the inquiry outlives it
    failed = conn.execute(
        "SELECT s.lat, s.lon, s.pasaj, o.price_toman FROM shops s LEFT JOIN offers o ON o.offer_id = %s WHERE s.shop_id = %s",
        [inquiry.offer_id, inquiry.shop_id],
    ).fetchone() or {"lat": None, "lon": None, "pasaj": None, "price_toman": None}
    reference_price = inquiry.reply.latest_price_toman or failed["price_toman"]
    origin = (failed["lat"], failed["lon"]) if failed["lat"] is not None else brief.origin and (brief.origin.lat, brief.origin.lon)
    # near the plan, not inside the brief's area: the area is where the first pick was made
    q = seller_query(brief, inquiry.product_id, now).model_copy(
        update={"lat": origin and origin[0], "lon": origin and origin[1], "radius_m": None, "area": None, "pasaj": None, "session_id": sid}
    )
    asked = outcomes(conn, sid, inquiry.product_id, now)

    def candidates(result) -> list[SellerRow]:
        rows = [r for r in result.sellers + result.ask_them if r.shop_id not in asked and r.open_now is not False]
        same = failed["pasaj"] is not None
        return sorted(rows, key=lambda r: (not (same and r.pasaj == failed["pasaj"]), r.open_now is not True, r.distance_m is None, r.distance_m or 0))

    sellers = find_sellers(conn, inquiry.product_id, q, now)
    picked = []
    for r in candidates(sellers)[:2]:
        price = r.latest_price.price_toman or r.price_toman
        a = Alternative(
            kind="same_product",
            offer_id=r.offer_id,
            product_id=inquiry.product_id,
            product_title=sellers.title,
            shop_id=r.shop_id,
            shop_name=r.shop_name,
            pasaj=r.pasaj,
            price_toman=price,
            price_delta_toman=price - reference_price if price is not None and reference_price is not None else None,
            same_pasaj=failed["pasaj"] is not None and r.pasaj == failed["pasaj"],
            open_now=r.open_now,
            distance_m=r.distance_m,
            tradeoff="",
        )
        a.tradeoff = _tradeoff(a)
        picked.append(a)
    return Alternatives(inquiry_id=inquiry_id, reason=inquiry.status, alternatives=picked)
