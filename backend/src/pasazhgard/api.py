import os
from datetime import UTC, datetime

import psycopg
from fastapi import Depends, FastAPI, Query
from psycopg.rows import dict_row

from pasazhgard.search import SearchResult, search_products

app = FastAPI(title="Pasazhgard")


def get_conn():
    # shortcut: one connection per request, move to a pool when load needs it
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
        yield conn


def get_now() -> datetime:
    return datetime.now(UTC)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/products/search")
def products_search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
) -> SearchResult:
    return search_products(conn, q, now, limit)
