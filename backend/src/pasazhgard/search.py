"""search_products: lexical product search over normalized titles."""

from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from pasazhgard.clean import BAD_PRICE_FLAGS, PriceFlag
from pasazhgard.normalize import normalize

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
    price_flags: list[PriceFlag]


class SearchResult(BaseModel):
    query: str
    items: list[ProductCard]


def price_age_bucket(days: int | None) -> PriceAgeBucket:
    # an unknown change date is treated as old
    if days is None or days > 30:
        return ">30"
    return "<=7" if days <= 7 else "8-30"


def _price_range(offers: list[dict], now: datetime) -> PriceRange:
    usable = [o for o in offers if not (BAD_PRICE_FLAGS | {PriceFlag.FAR_FROM_MEDIAN}) & set(o["price_flags"])]
    per_piece = [o for o in usable if PriceFlag.PER_METER not in o["price_flags"]]
    # prefer per-piece prices, fall back to per-meter when a product has only those
    priced = per_piece or usable
    if not priced:
        return PriceRange(
            trust_level="unknown", min_toman=None, max_toman=None, per_meter=False,
            last_price_changed_at=None, price_age_days=None, price_age_bucket=None,
        )
    prices = [o["price_toman"] for o in priced]
    changes = [o["last_price_changed_at"] for o in priced if o["last_price_changed_at"]]
    newest = max(changes).astimezone(UTC) if changes else None
    tehran = ZoneInfo("Asia/Tehran")
    days = (now.astimezone(tehran).date() - newest.astimezone(tehran).date()).days if newest else None
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
    # punctuation-only tokens like "-" carry no signal
    tokens = [t for t in normalize(query).split() if any(ch.isalnum() for ch in t)]
    # short words like "20" match most rows, so they only rank and do not select
    selective = [t for t in tokens if len(t) >= 3] or tokens
    # each query word is matched on its own, so word order and words in between do not matter.
    # A word weighs more the fewer candidates contain it, so common words like "برای" cannot
    # outvote the product words; a word no candidate contains weighs nothing.
    # shortcut: common words still scan many rows (1-2 s on the full data), revisit with hybrid search
    products = conn.execute(
        """
        WITH cand AS (
            SELECT product_id, title, brand, category, image_urls, specs,
                   ARRAY(SELECT word_similarity(t, search_text)
                         FROM unnest(%(tokens)s::text[]) WITH ORDINALITY u(t, i) ORDER BY i) AS sims
            FROM products
            WHERE search_text %%> ANY(%(selective)s::text[])
        ),
        weight AS (
            SELECT i, CASE WHEN count(*) FILTER (WHERE sims[i] >= %(word_match)s) = 0 THEN 0
                           ELSE ln(1 + (SELECT count(*) FROM cand)::float8
                                       / count(*) FILTER (WHERE sims[i] >= %(word_match)s)) END AS w
            FROM cand, generate_series(1, %(n)s) i
            GROUP BY i
        ),
        scored AS (
            SELECT *, (SELECT sum(w * sims[i]) / nullif(sum(w), 0) FROM weight) AS score FROM cand
        )
        SELECT * FROM scored
        WHERE score >= %(min_score)s
        ORDER BY score DESC, product_id
        LIMIT %(limit)s
        """,
        {"tokens": tokens, "selective": selective, "n": len(tokens), "word_match": 0.6, "min_score": 0.5, "limit": limit},
    ).fetchall()
    offers = conn.execute(
        "SELECT product_id, price_toman, last_price_changed_at, price_flags FROM offers WHERE product_id = ANY(%s)",
        [[p["product_id"] for p in products]],
    ).fetchall()
    by_product = {}
    for o in offers:
        by_product.setdefault(o["product_id"], []).append(o)

    # spec rows that repeat what the title already says
    title_spec_words = ("برند", "مدل", "نام", "سازنده")
    key_spec_count = 3
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
                key_specs=[s for s in p["specs"] if not any(w in s["key"] for w in title_spec_words)][:key_spec_count],
                offer_count=len(own),
                price=_price_range(own, now),
                price_flags=[f for f in PriceFlag if f in flags],
            )
        )
    return SearchResult(query=query, items=items)
