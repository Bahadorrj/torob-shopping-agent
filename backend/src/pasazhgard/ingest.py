"""Load the dataset CSVs into the database. Idempotent: tables are rebuilt in one transaction.

Usage: python -m pasazhgard.ingest <data dir>   (reads DATABASE_URL)
"""

import csv
import os
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from pasazhgard.clean import _null, clean_offer, clean_product, flag_far_from_median


def _rows(path: Path):
    csv.field_size_limit(sys.maxsize)
    with open(path, encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


def _float(value: str) -> float | None:
    value = _null(value)
    return float(value) if value else None


def _copy(cur, table: str, columns: list[str], types: list[str], rows) -> None:
    with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as copy:
        copy.set_types(types)
        for row in rows:
            copy.write_row(row)


def ingest(data_dir: Path, database_url: str) -> None:
    schema = """
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    DROP TABLE IF EXISTS offers, products, shops;
    CREATE TABLE shops (
        shop_id text PRIMARY KEY,
        name text NOT NULL,
        address text,
        location_label text,
        lat double precision,
        lon double precision
    );
    CREATE TABLE products (
        product_id text PRIMARY KEY,
        title text NOT NULL,
        brand text,
        category text,
        model text,
        image_urls text[] NOT NULL,
        specs jsonb NOT NULL,
        search_text text NOT NULL
    );
    CREATE TABLE offers (
        offer_id text PRIMARY KEY,
        product_id text NOT NULL REFERENCES products,
        shop_id text NOT NULL REFERENCES shops,
        seller_title text NOT NULL,
        price_toman bigint,
        last_price_changed_at timestamptz,
        price_flags text[] NOT NULL
    );
    """
    indexes = """
    CREATE INDEX products_search_text_trgm ON products USING gin (search_text gin_trgm_ops);
    CREATE INDEX offers_product_id ON offers (product_id);
    CREATE INDEX offers_shop_id ON offers (shop_id);
    """
    offers = [clean_offer(r) for r in _rows(data_dir / "offers.csv")]
    flag_far_from_median(offers)

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute(schema)
        _copy(
            cur,
            "shops",
            ["shop_id", "name", "address", "location_label", "lat", "lon"],
            ["text", "text", "text", "text", "float8", "float8"],
            (
                (r["shop_id"], r["name"], r["address"], r["location_label"], _float(r["lat"]), _float(r["lon"]))
                for r in _rows(data_dir / "shops.csv")
            ),
        )
        product_cols = ["product_id", "title", "brand", "category", "model", "image_urls", "specs", "search_text"]
        _copy(
            cur,
            "products",
            product_cols,
            ["text", "text", "text", "text", "text", "text[]", "jsonb", "text"],
            (
                tuple(Jsonb(p[k]) if k == "specs" else p[k] for k in product_cols)
                for p in map(clean_product, _rows(data_dir / "products.csv"))
            ),
        )
        offer_cols = ["offer_id", "product_id", "shop_id", "seller_title", "price_toman", "last_price_changed_at", "price_flags"]
        _copy(
            cur,
            "offers",
            offer_cols,
            ["text", "text", "text", "text", "int8", "timestamptz", "text[]"],
            ([o[k] for k in offer_cols] for o in offers),
        )
        cur.execute(indexes)


if __name__ == "__main__":
    ingest(Path(sys.argv[1]), os.environ["DATABASE_URL"])
