"""pasaj_view: the relevant shops in one pasaj, grouped by floor, so the user can cover it floor by floor."""

import re
from datetime import datetime

from pydantic import BaseModel

from pasazhgard.brief import CompareStep, SellersStep, Session
from pasazhgard.normalize import normalize
from pasazhgard.search import _price_range

_NUMBERS = {
    w: n
    for n, words in enumerate(
        [("همکف",), ("اول", "یک"), ("دوم", "دو"), ("سوم", "سه"), ("چهارم", "چهار"), ("پنجم", "پنج"), ("ششم", "شش"),
         ("هفتم", "هفت"), ("هشتم", "هشت"), ("نهم", "نه"), ("دهم", "ده")]
    )
    for w in words
}
_BASEMENT = re.compile(r"^(زیر ?همکف|زیر ?زمین|زیرین)\b")
_LEVEL = re.compile(r"^(منفی ?|-)?(\d+|" + "|".join(sorted(_NUMBERS, key=len, reverse=True)) + r")(-)?")


def floor_level(floor: str | None) -> int | None:
    """"همکف" 0, "زیر همکف" -1, "منفی ۲" / "۲-" -2, "سوم" / "۳" 3; None for a spelling it does not know."""
    if floor is None:
        return None
    # a tatweel before a number ("ـ۱") is a typed minus, and normalize would drop it
    text = normalize(floor.replace("ـ", "-")).removeprefix("ی ").strip().replace("هم کف", "همکف")
    if re.match(r"^(زیر ?همکف|زیر ?زمین|زیرین)\b", text):
        return -1
    m = _LEVEL.match(text)
    if m is None:
        return None
    n = int(m[2]) if m[2].isdigit() else _NUMBERS[m[2]]
    return -n if m[1] or m[3] else n


class PasajProduct(BaseModel):
    product_id: str
    title: str
    price_toman: int | None


class PasajShop(BaseModel):
    shop_id: str
    shop_name: str
    unit: str | None
    # the asked products this shop lists
    products: list[PasajProduct]


class Floor(BaseModel):
    """`floor` is the first shop's spelling; None groups the shops whose floor is not recorded."""

    floor: str | None
    level: int | None
    shops: list[PasajShop]


class PasajView(BaseModel):
    pasaj: str
    count: int
    floors: list[Floor]


def brief_products(session: Session) -> list[str]:
    """The brief's items and the product the session is on."""
    step = session.step
    current = [step.product_id] if isinstance(step, SellersStep) else step.product_ids if isinstance(step, CompareStep) else []
    return [i.product_id for i in session.brief.items if i.product_id] + current


def pasaj_view(conn, pasaj: str, product_ids: list[str], now: datetime) -> PasajView | None:
    shops = conn.execute("SELECT shop_id, name, floor, unit FROM shops WHERE pasaj = %s", [pasaj]).fetchall()
    if not shops:
        return None
    offers = conn.execute(
        """
        SELECT o.*, p.title FROM offers o JOIN products p USING (product_id) JOIN shops s USING (shop_id)
        WHERE s.pasaj = %s AND o.product_id = ANY(%s)
        """,
        [pasaj, product_ids],
    ).fetchall()
    listed: dict[str, dict[str, PasajProduct]] = {}
    for o in sorted(offers, key=lambda o: o["offer_id"]):
        price = _price_range([o], now).min_toman
        best = listed.setdefault(o["shop_id"], {}).get(o["product_id"])
        if best is None or price is not None and (best.price_toman is None or price < best.price_toman):
            listed[o["shop_id"]][o["product_id"]] = PasajProduct(product_id=o["product_id"], title=o["title"], price_toman=price)
    groups: dict[object, Floor] = {}
    for s in sorted(shops, key=lambda s: (s["unit"] is None, s["unit"] or "", s["name"])):
        # without a product to match, every shop in the pasaj is relevant
        if product_ids and s["shop_id"] not in listed:
            continue
        level = floor_level(s["floor"])
        # a spelling without a level keeps its own group
        key = level if level is not None else normalize(s["floor"] or "") or None
        group = groups.setdefault(key, Floor(floor=s["floor"] or None, level=level, shops=[]))
        group.shops.append(
            PasajShop(shop_id=s["shop_id"], shop_name=s["name"], unit=s["unit"], products=list(listed.get(s["shop_id"], {}).values()))
        )
    floors = sorted(groups.values(), key=lambda f: (f.level is None, f.floor is None, f.level or 0, f.floor or ""))
    return PasajView(pasaj=pasaj, count=sum(len(f.shops) for f in floors), floors=floors)
