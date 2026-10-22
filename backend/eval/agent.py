"""Agent eval: the queries of eval/search_queries.json and eval/discovery_queries.json, each a conversation with
POST /agent (seam 1) and the chat model from env. Reports the top-5 hit rate, for cases with `expected_shops` whether
every seller shown is one of them (the shops that meet the case's place and conditions), for vague needs whether the
shortlist holds a model of the right category with nearby sellers, and every price, shop or availability claim in agent
text that the turn's tool output does not back. A case's `now` sets the clock for its time conditions.
Quality check, not a CI gate.

Usage: uv run python eval/agent.py   (reads DATABASE_URL; the real model with LLM_API_KEY, degraded without)
"""

import json
import os
import uuid
from datetime import datetime
from pathlib import Path

import psycopg

from pasazhgard.api import get_now
from pasazhgard.grounding import known_shops, ungrounded_turn


def turn(client, session_id: str, history: list[dict], text: str) -> list[dict] | None:
    """One AG-UI run, as CopilotKit sends it: the thread after this turn, or None when the run failed."""
    r = client.post(
        "/agent",
        json={
            "threadId": session_id,
            "runId": uuid.uuid4().hex,
            "state": {},
            "messages": [*history, {"id": uuid.uuid4().hex, "role": "user", "content": text}],
            "tools": [],
            "context": [],
            "forwardedProps": {},
        },
        headers={"accept": "text/event-stream"},
    )
    r.raise_for_status()
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    if not events or events[-1]["type"] != "RUN_FINISHED":
        print(f"  run failed: {events[-1] if events else r.text[:200]}")
        return None
    return [e for e in events if e["type"] == "MESSAGES_SNAPSHOT"][-1]["messages"]


def brief_of(case: dict) -> dict:
    """The conditions a case sets in the brief bar before the user speaks."""
    brief = {}
    if "pasaj" in case:
        brief["area"] = {"pasaj": case["pasaj"]}
    elif "area" in case:
        brief["area"] = {"name": case["area"]}
    if "max_per_item_toman" in case:
        brief["budget"] = {"max_per_item_toman": case["max_per_item_toman"]}
    return brief


def converse(client, case: dict, report: dict, shops) -> list[dict]:
    """Runs one case to a turn without a question; the blocks it showed. Ungrounded claims go to the report."""
    # the reply to a clarifying question; ask_user refuses a fourth question in a row
    no_preference = "فرقی نمی‌کنه، خودت پیشنهاد بده"
    text = case.get("query") or case["need"]
    overrides = client.app.dependency_overrides
    saved = overrides.get(get_now, get_now)
    if "now" in case:
        at = datetime.fromisoformat(case["now"])
        overrides[get_now] = lambda: at
    try:
        session_id = client.post("/sessions").json()["session_id"]
        if brief := brief_of(case):
            client.patch(f"/sessions/{session_id}", json={"brief": brief}).raise_for_status()
        thread, blocks = [], []
        for _ in range(4):
            start = len(thread)
            thread = turn(client, session_id, thread, text)
            if thread is None:
                break
            report["ungrounded"] += [(case.get("query") or case["need"], claim) for claim in ungrounded_turn(thread, shops)]
            shown = []
            for m in thread[start:]:
                if m["role"] == "tool":
                    try:
                        shown.append(json.loads(m["content"]))
                    except ValueError:
                        pass
            blocks += shown
            if not any(b.get("block") == "chips" for b in shown):
                break
            text = no_preference
        return blocks
    finally:
        overrides[get_now] = saved


def run(client, cases: list[dict]) -> dict:
    """Query cases (`expected` product ids) count toward the top-5 hit rate, cases with `expected_shops` toward the
    shop hit rate, need cases (`category`) toward the shortlist hit rate."""
    report = {"hits": 0, "queries": 0, "shop_hits": 0, "shop_cases": 0, "shortlists": 0, "needs": 0, "ungrounded": []}
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        shops = known_shops(conn)
    for case in cases:
        blocks = converse(client, case, report, shops)
        # the first five products the user saw, cards and shortlist models in the order shown
        products = [p for b in blocks for p in (b["items"] if b.get("block") == "product_cards" else b["models"] if b.get("block") == "model_shortlist" else [])]
        models = [m for b in blocks if b.get("block") == "model_shortlist" for m in b["models"]]
        if "expected" in case:
            hit = any(p["product_id"] in case["expected"] for p in products[:5])
            report["queries"] += 1
            report["hits"] += hit
            label = case["query"]
        else:
            hit = any(m["category"] == case["category"] and m["seller_count"] > 0 for m in models)
            report["needs"] += 1
            report["shortlists"] += hit
            label = case["need"]
        if "expected_shops" in case:
            sellers = {s["shop_id"] for b in blocks for s in b.get("sellers", []) + b.get("stops", [])}
            shop_hit = bool(sellers) and sellers <= set(case["expected_shops"])
            report["shop_cases"] += 1
            report["shop_hits"] += shop_hit
            label += f"  [shops {'ok' if shop_hit else 'MISS'}]"
        shown = " / ".join(p["title"] for p in products[:3]) or "(nothing shown)"
        print(f"{'hit ' if hit else 'MISS'}  {label}  ->  {shown}")
    return report


if __name__ == "__main__":
    import asyncio

    from fastapi.testclient import TestClient

    from pasazhgard.api import app, get_chat_model, get_embedder

    here = Path(__file__).parent
    cases = [json.loads((here / f).read_text(encoding="utf-8")) for f in ("search_queries.json", "discovery_queries.json")]
    # the agent's async checkpointer cannot run on Windows' default Proactor loop
    with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}) as client:
        report = run(client, cases[0] + cases[1])
    print(f"mode: {'model' if get_chat_model() else 'degraded (no LLM_API_KEY)'}, {'hybrid' if get_embedder() else 'lexical'} search")
    print(f"top-5 hit rate: {report['hits']}/{report['queries']} ({report['hits'] / max(report['queries'], 1):.0%}), target >= 80%")
    print(f"cases showing only expected shops: {report['shop_hits']}/{report['shop_cases']}")
    print(f"vague needs with a nearby shortlist: {report['shortlists']}/{report['needs']}")
    print(f"ungrounded claims: {len(report['ungrounded'])} (target 0)")
    for query, claim in report["ungrounded"]:
        print(f"  {claim}  in  {query}")
