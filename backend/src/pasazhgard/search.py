"""search_products: lexical product search over normalized titles."""

from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from pasazhgard.clean import BAD_PRICE_FLAGS
from pasazhgard.normalize import normalize

TEHRAN = ZoneInfo("Asia/Tehran")
FLAG_ORDER = ["missing", "placeholder", "invalid", "per_meter", "far_from_median"]
KEY_SPEC_COUNT = 3
MIN_SCORE = 0.5
# spec rows that repeat what the title already says
_TITLE_SPEC_WORDS = ("برند", "مدل", "نام", "سازنده")

PriceAgeBucket = Literal["<=7", "8-30", ">30"]


class Spec(BaseModel):
    key: str
    value: str


class PriceRange(BaseModel):
    """A product's listed price range. `unknown` when no offer has a usable price."""

    trust_level: Literal["listed", "unknown"]
    min_toman: int | None
    max_toman: int | None
    per_meter: bool
    last_price_changed_at: datetime | None
    price_age_days: int | None
    price_age_bucket: PriceAgeBucket | None


class ProductCard(BaseModel):
    product_id: str
    title: str
    brand: str | None
    category: str | None
    image_url: str | None
    key_specs: list[Spec]
    offer_count: int
    price: PriceRange
    price_flags: list[str]


class SearchResult(BaseModel):
    query: str
    items: list[ProductCard]


def price_age_bucket(days: int | None) -> PriceAgeBucket:
    # an unknown change date is treated as old
    if days is None or days > 30:
        return ">30"
    return "<=7" if days <= 7 else "8-30"


def _price_range(offers: list[dict], now: datetime) -> PriceRange:
    usable = [o for o in offers if not (BAD_PRICE_FLAGS | {"far_from_median"}) & set(o["price_flags"])]
    per_piece = [o for o in usable if "per_meter" not in o["price_flags"]]
    priced = per_piece or usable
    if not priced:
        return PriceRange(
            trust_level="unknown", min_toman=None, max_toman=None, per_meter=False,
            last_price_changed_at=None, price_age_days=None, price_age_bucket=None,
        )
    prices = [o["price_toman"] for o in priced]
    changes = [o["last_price_changed_at"] for o in priced if o["last_price_changed_at"]]
    newest = max(changes).astimezone(UTC) if changes else None
    days = (now.astimezone(TEHRAN).date() - newest.astimezone(TEHRAN).date()).days if newest else None
    return PriceRange(
        trust_level="listed",
        min_toman=min(prices),
        max_toman=max(prices),
        per_meter=not per_piece,
        last_price_changed_at=newest,
        price_age_days=days,
        price_age_bucket=price_age_bucket(days),
    )


def search_products(conn, query: str, now: datetime, limit: int = 20) -> SearchResult:
    tokens = normalize(query).split()
    # short words like "20" match most rows, so they only rank and do not select
    selective = [t for t in tokens if len(t) >= 3] or tokens
    # each query word is matched on its own, so word order and words in between do not matter
    # shortcut: common words still scan many rows (about 1 s on the full data), revisit with hybrid search
    products = conn.execute(
        """
        SELECT * FROM (
            SELECT product_id, title, brand, category, image_urls, specs,
                   (SELECT avg(word_similarity(t, search_text)) FROM unnest(%(tokens)s::text[]) t) AS score
            FROM products
            WHERE search_text %%> ANY(%(selective)s::text[])
        ) matched
        WHERE score >= %(min_score)s
        ORDER BY score DESC, product_id
        LIMIT %(limit)s
        """,
        {"tokens": tokens, "selective": selective, "min_score": MIN_SCORE, "limit": limit},
    ).fetchall()
    offers = conn.execute(
        "SELECT product_id, price_toman, last_price_changed_at, price_flags FROM offers WHERE product_id = ANY(%s)",
        [[p["product_id"] for p in products]],
    ).fetchall()
    by_product = {}
    for o in offers:
        by_product.setdefault(o["product_id"], []).append(o)

    items = []
    for p in products:
        own = by_product.get(p["product_id"], [])
        flags = {f for o in own for f in o["price_flags"]}
        items.append(
            ProductCard(
                product_id=p["product_id"],
                title=p["title"],
                brand=p["brand"],
                category=p["category"],
                image_url=next(iter(p["image_urls"]), None),
                key_specs=[s for s in p["specs"] if not any(w in s["key"] for w in _TITLE_SPEC_WORDS)][:KEY_SPEC_COUNT],
                offer_count=len(own),
                price=_price_range(own, now),
                price_flags=[f for f in FLAG_ORDER if f in flags],
            )
        )
    return SearchResult(query=query, items=items)
