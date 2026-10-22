"""Search eval: top-5 hit rate over eval/search_queries.json. Quality check, not a CI gate.

Usage: uv run python eval/search.py   (reads DATABASE_URL; hybrid with LLM_API_KEY, lexical without)
"""

import json
import os
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from pasazhgard.embeddings import embedder_from_env
from pasazhgard.search import search_products
from pasazhgard.shops import TEHRAN

cases = json.loads((Path(__file__).parent / "search_queries.json").read_text(encoding="utf-8"))
embedder = embedder_from_env()
hits = 0
with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
    for case in cases:
        top = search_products(conn, case["query"], datetime.now(TEHRAN), 5, embedder).items
        hit = any(card.product_id in case["expected"] for card in top)
        hits += hit
        print(f"{'hit ' if hit else 'MISS'}  {case['query']}  ->  {top[0].title if top else '(no results)'}")
print(f"mode: {'hybrid' if embedder else 'lexical'}")
print(f"top-5 hit rate: {hits}/{len(cases)} ({hits / len(cases):.0%})")
