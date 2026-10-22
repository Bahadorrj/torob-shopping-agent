"""search_products: hybrid product search, lexical over normalized titles merged with semantic neighbours."""

import logging
import re
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from pasazhgard.clean import BAD_PRICE_FLAGS, PriceFlag
from pasazhgard.embeddings import Embedder
from pasazhgard.normalize import normalize

log = logging.getLogger(__name__)

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


def price_age_bucket(days: int | None) -> PriceAgeBucket | None:
    if days is None:
        return None
    if days > 30:
        return ">30"
    return "<=7" if days <= 7 else "8-30"


def _usable(offers: list[dict]) -> list[dict]:
    return [o for o in offers if not (BAD_PRICE_FLAGS | {PriceFlag.FAR_FROM_MEDIAN}) & set(o["price_flags"])]


def _product_flags(offers: list[dict]) -> list[PriceFlag]:
    flags = {f for o in offers for f in o["price_flags"]}
    # the per-meter note is about prices shown, so a per-meter offer with a dropped price does not count
    if not any(PriceFlag.PER_METER in o["price_flags"] for o in _usable(offers)):
        flags.discard(PriceFlag.PER_METER)
    return [f for f in PriceFlag if f in flags]


def _price_range(offers: list[dict], now: datetime) -> PriceRange:
    usable = _usable(offers)
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


def _lexical(conn, query: str, pool: int) -> list[str]:
    # punctuation-only tokens like "-" carry no signal
    tokens = [t for t in normalize(query).split() if any(ch.isalnum() for ch in t)]
    # short words like "20" match most rows, so they only rank and do not select
    selective = [t for t in tokens if len(t) >= 3] or tokens
    # each query word is matched on its own, so word order and words in between do not matter.
    # A word weighs more the fewer candidates contain it, so common words like "برای" cannot
    # outvote the product words; a word no candidate contains weighs nothing.
    # shortcut: common words still scan many rows (1-2 s on the full data), revisit if search latency suffers
    rows = conn.execute(
        """
        WITH cand AS (
            SELECT product_id,
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
        SELECT product_id FROM scored
        WHERE score >= %(min_score)s
        ORDER BY score DESC, product_id
        LIMIT %(limit)s
        """,
        {"tokens": tokens, "selective": selective, "n": len(tokens), "word_match": 0.6, "min_score": 0.5, "limit": pool},
    ).fetchall()
    return [r["product_id"] for r in rows]


def _semantic(conn, query: str, embedder: Embedder | None, pool: int) -> list[str]:
    if embedder is None:
        return []
    # text-embedding-3-small puts related products above about 0.3 cosine similarity, unrelated ones below
    max_distance = 0.7
    try:
        vector = embedder.embed([query])[0]
    except Exception:
        # degraded mode: any provider failure leaves the lexical results
        log.warning("query embedding failed, searching lexically", exc_info=True)
        return []
    rows = conn.execute(
        "SELECT product_id, embedding <=> %s::vector AS distance FROM products ORDER BY distance LIMIT %s",
        [str(vector), pool],
    ).fetchall()
    return [r["product_id"] for r in rows if r["distance"] is not None and r["distance"] <= max_distance]


def search_products(conn, query: str, now: datetime, limit: int = 20, embedder: Embedder | None = None) -> SearchResult:
    # candidates per source; also the most an HNSW scan returns at its default ef_search
    pool = 40
    # reciprocal rank fusion: a product high in either list ranks high, one in both ranks higher
    rrf_k = 10
    # a product of the brand the query names beats a few ranks; one in the named category, fewer
    brand_boost, category_boost = 0.05, 0.025
    score: dict[str, float] = {}
    for ranked in (_lexical(conn, query, pool), _semantic(conn, query, embedder, pool)):
        for rank, product_id in enumerate(ranked, 1):
            score[product_id] = score.get(product_id, 0) + 1 / (rrf_k + rank)
    found = {
        p["product_id"]: p
        for p in conn.execute(
            "SELECT product_id, title, brand, category, image_urls, specs, brand_terms FROM products WHERE product_id = ANY(%s)",
            [list(score)],
        )
    }
    padded = f" {normalize(query)} "
    words = {w for w in padded.split() if len(w) >= 3}
    for product_id, p in found.items():
        if any(f" {term} " in padded for term in p["brand_terms"]):
            score[product_id] += brand_boost
        if words & set(re.findall(r"\w+", normalize(p["category"] or ""))):
            score[product_id] += category_boost
    products = [found[p] for p in sorted(score, key=lambda p: (-score[p], p))[:limit]]
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
                price_flags=_product_flags(own),
            )
        )
    return SearchResult(query=query, items=items)
