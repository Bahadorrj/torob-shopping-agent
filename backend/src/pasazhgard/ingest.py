"""Load the dataset CSVs into the database. Idempotent: tables are rebuilt in one transaction.

The new tables are built in a staging schema while searches keep reading the old ones; the
swap at the end is the only step that locks them.

Usage: python -m pasazhgard.ingest <data dir>   (reads DATABASE_URL)
"""

import csv
import os
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from pasazhgard.clean import add_brand_aliases, clean_offer, clean_product, clean_shop, flag_far_from_median
from pasazhgard.embeddings import Embedder, embedder_from_env


def _rows(path: Path):
    csv.field_size_limit(sys.maxsize)
    with open(path, encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


def _copy(cur, table: str, columns: list[str], types: list[str], rows) -> None:
    with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as copy:
        copy.set_types(types)
        for row in rows:
            copy.write_row(row)


def _embed_products(cur, embedder: Embedder, database_url: str) -> None:
    """Fill products.embedding from a cache that outlives re-ingests, so only new texts reach the paid provider."""
    batch = 1000
    doc = "concat_ws(' ', title, brand, category)"
    missing = [
        r[0]
        for r in cur.execute(
            f"SELECT DISTINCT {doc} FROM products EXCEPT SELECT doc FROM public.embedding_cache WHERE model = %s",
            [embedder.name],
        )
    ]
    # committed batch by batch outside the ingest transaction, so a failed run keeps what it paid for
    with psycopg.connect(database_url, autocommit=True) as conn:
        for i in range(0, len(missing), batch):
            docs = missing[i : i + batch]
            with conn.cursor().copy("COPY embedding_cache (model, doc, embedding) FROM STDIN") as copy:
                for d, v in zip(docs, embedder.embed(docs), strict=True):
                    copy.write_row((embedder.name, d, str(v)))
    cur.execute(
        f"UPDATE products SET embedding = c.embedding FROM public.embedding_cache c WHERE c.model = %s AND c.doc = {doc}",
        [embedder.name],
    )
    cur.execute("CREATE INDEX products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops)")


def ingest(data_dir: Path, database_url: str, embedder: Embedder | None = None) -> None:
    """Without an embedder the products get no vectors and search stays lexical."""
    cache = """
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS embedding_cache (
        model text,
        doc text,
        embedding vector NOT NULL,
        PRIMARY KEY (model, doc)
    );
    """
    schema = """
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    DROP SCHEMA IF EXISTS staging CASCADE;
    CREATE SCHEMA staging;
    SET LOCAL search_path = staging, public;
    CREATE TABLE shops (
        shop_id text PRIMARY KEY,
        name text NOT NULL,
        address text,
        location_label text,
        lat double precision,
        lon double precision,
        categories text[] NOT NULL,
        pasaj text,
        floor text,
        unit text,
        landmark text,
        hours jsonb NOT NULL,
        payment_options jsonb NOT NULL,
        fast_delivery text NOT NULL,
        website_url text,
        instagram_url text
    );
    CREATE TABLE products (
        product_id text PRIMARY KEY,
        title text NOT NULL,
        brand text,
        category text,
        model text,
        image_urls text[] NOT NULL,
        specs jsonb NOT NULL,
        search_text text NOT NULL,
        brand_terms text[] NOT NULL,
        embedding vector{dimensions}
    );
    CREATE TABLE offers (
        offer_id text PRIMARY KEY,
        product_id text NOT NULL REFERENCES products,
        shop_id text NOT NULL REFERENCES shops,
        seller_title text NOT NULL,
        price_toman bigint,
        last_price_changed_at timestamptz,
        price_flags text[] NOT NULL,
        warranty jsonb
    );
    """
    indexes = """
    CREATE INDEX products_search_text_trgm ON products USING gin (search_text gin_trgm_ops);
    CREATE INDEX offers_product_id ON offers (product_id);
    CREATE INDEX offers_shop_id ON offers (shop_id);
    """
    swap = """
    SET LOCAL search_path = public;
    DROP TABLE IF EXISTS offers, products, shops;
    ALTER TABLE staging.shops SET SCHEMA public;
    ALTER TABLE staging.products SET SCHEMA public;
    ALTER TABLE staging.offers SET SCHEMA public;
    DROP SCHEMA staging;
    -- sessions outlive a re-ingest
    CREATE TABLE IF NOT EXISTS sessions (
        session_id text PRIMARY KEY,
        brief jsonb NOT NULL,
        step jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    -- no foreign key to offers or shops: an inquiry is a record of what was asked, and outlives a re-ingest
    CREATE TABLE IF NOT EXISTS inquiries (
        inquiry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        session_id text NOT NULL REFERENCES sessions ON DELETE CASCADE,
        offer_id text NOT NULL,
        product_id text NOT NULL,
        product_title text NOT NULL,
        shop_id text NOT NULL,
        shop_name text NOT NULL,
        status text NOT NULL,
        message text NOT NULL,
        channel text,
        reply jsonb NOT NULL,
        events jsonb NOT NULL
    );
    CREATE INDEX IF NOT EXISTS inquiries_session_id ON inquiries (session_id);
    CREATE INDEX IF NOT EXISTS inquiries_shop_id ON inquiries (shop_id);
    """
    offers = [clean_offer(r) for r in _rows(data_dir / "offers.csv")]
    flag_far_from_median(offers)
    products = [clean_product(r) for r in _rows(data_dir / "products.csv")]
    add_brand_aliases(products)

    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(cache)
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(schema.replace("{dimensions}", f"({embedder.dimensions})" if embedder else ""))
        shop_cols = [
            "shop_id", "name", "address", "location_label", "lat", "lon", "categories", "pasaj", "floor", "unit", "landmark",
            "hours", "payment_options", "fast_delivery", "website_url", "instagram_url",
        ]
        _copy(
            cur,
            "shops",
            shop_cols,
            ["text", "text", "text", "text", "float8", "float8", "text[]", "text", "text", "text", "text", "jsonb", "jsonb", "text", "text", "text"],
            (
                tuple(Jsonb(c[k]) if k in ("hours", "payment_options") else c[k] for k in shop_cols)
                for c in map(clean_shop, _rows(data_dir / "shops.csv"))
            ),
        )
        product_cols = ["product_id", "title", "brand", "category", "model", "image_urls", "specs", "search_text", "brand_terms"]
        _copy(
            cur,
            "products",
            product_cols,
            ["text", "text", "text", "text", "text", "text[]", "jsonb", "text", "text[]"],
            (
                tuple(Jsonb(p[k]) if k == "specs" else p[k] for k in product_cols)
                for p in products
            ),
        )
        offer_cols = [
            "offer_id", "product_id", "shop_id", "seller_title", "price_toman", "last_price_changed_at", "price_flags", "warranty",
        ]
        _copy(
            cur,
            "offers",
            offer_cols,
            ["text", "text", "text", "text", "int8", "timestamptz", "text[]", "jsonb"],
            # an unknown warranty is SQL NULL, not a JSON null
            (tuple((Jsonb(o[k]) if o[k] else None) if k == "warranty" else o[k] for k in offer_cols) for o in offers),
        )
        if embedder:
            _embed_products(cur, embedder, database_url)
        cur.execute(indexes)
        cur.execute(swap)


if __name__ == "__main__":
    # a batch of 1000 texts takes longer than one query, and a retry is cheaper than rerunning the ingest
    ingest(Path(sys.argv[1]), os.environ["DATABASE_URL"], embedder_from_env(timeout=60, max_retries=2))
