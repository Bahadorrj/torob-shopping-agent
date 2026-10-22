import os

import psycopg
from conftest import Agent, ScriptedModel
from langchain_core.messages import AIMessage
from psycopg.rows import dict_row
from test_inquiries import MANSA, sent

from pasazhgard.responder import Responder, decide, respond, responder_from_env

LISTED = 3_500_000  # MANSA's listing


def run(client, config, now, chat=None, small=None):
    with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as conn:
        respond(conn, config, now, chat, small)


def inquiry(client, sid):
    [i] = client.get(f"/sessions/{sid}/inquiries").json()["inquiries"]
    return i


def test_an_out_of_stock_seller_replies_unavailable_labeled_simulated(client, now):
    sid, _ = sent(client, MANSA)

    run(client, Responder(out_of_stock=1, no_reply=0), now)

    i = inquiry(client, sid)
    assert (i["status"], i["simulated"]) == ("unavailable", True)
    assert i["events"][-1]["reply"] == {"available": "no", "auto": True}


def test_a_silent_seller_leaves_the_inquiry_sent(client, now):
    sid, _ = sent(client, MANSA)

    run(client, Responder(no_reply=1), now)

    assert inquiry(client, sid)["status"] == "sent"


def test_a_seller_in_stock_confirms_the_listed_or_a_changed_price(client, now):
    sid, _ = sent(client, MANSA)
    run(client, Responder(out_of_stock=0, no_reply=0, price_change=0), now)
    assert (inquiry(client, sid)["status"], inquiry(client, sid)["reply"]["latest_price_toman"]) == ("confirmed", LISTED)

    sid, _ = sent(client, MANSA)
    run(client, Responder(out_of_stock=0, no_reply=0, price_change=1), now)
    price = inquiry(client, sid)["reply"]["latest_price_toman"]
    assert price != LISTED and 0.85 * LISTED <= price <= 1.15 * LISTED


def test_decisions_are_seeded_and_follow_the_rates():
    config = Responder(seed=7, out_of_stock=0.3, no_reply=0.2, price_change=0.5)
    replies = [decide(config, i, LISTED) for i in range(1000)]

    assert replies == [decide(Responder(seed=7, out_of_stock=0.3, no_reply=0.2, price_change=0.5), i, LISTED) for i in range(1000)]
    assert replies != [decide(Responder(seed=8, out_of_stock=0.3, no_reply=0.2, price_change=0.5), i, LISTED) for i in range(1000)]
    silent = replies.count(None)
    out = sum(1 for r in replies if r and r.available == "no")
    changed = sum(1 for r in replies if r and r.available == "yes" and r.latest_price_toman != LISTED)
    assert 150 < silent < 250
    assert 0.25 < out / (1000 - silent) < 0.35
    assert 0.45 < changed / (1000 - silent - out) < 0.55


def test_role_played_text_goes_through_the_reply_parse(client, now):
    # earlier tests' sent inquiries would take the scripted replies
    run(client, Responder(no_reply=0), now)
    sid, _ = sent(client, MANSA)
    text = "بله موجوده، امروز ۳ میلیون و ۶۰۰"
    chat = ScriptedModel(messages=iter([AIMessage(text)]))
    small = ScriptedModel(messages=iter([Agent.call("ReplyParse", available="yes", latest_price_toman=3_600_000, confidence=0.9)]))

    run(client, Responder(out_of_stock=0, no_reply=0), now, chat, small)

    i = inquiry(client, sid)
    assert (i["status"], i["reply"]["latest_price_toman"], i["reply"]["confidence"]) == ("confirmed", 3_600_000, 0.9)
    assert i["events"][-1]["reply"] == {"text": text, "auto": True}


def test_a_failed_role_play_falls_back_to_quick_replies(client, now):
    sid, _ = sent(client, MANSA)
    chat = ScriptedModel(messages=iter([]))

    run(client, Responder(out_of_stock=1, no_reply=0), now, chat)

    assert inquiry(client, sid)["status"] == "unavailable"


def test_the_auto_responder_is_off_unless_configured(monkeypatch):
    monkeypatch.delenv("AUTO_RESPONDER_ENABLED", raising=False)
    assert responder_from_env() is None

    monkeypatch.setenv("AUTO_RESPONDER_ENABLED", "true")
    monkeypatch.setenv("AUTO_RESPONDER_SEED", "42")
    monkeypatch.setenv("AUTO_RESPONDER_OUT_OF_STOCK", "0.1")
    monkeypatch.setenv("AUTO_RESPONDER_NO_REPLY", "0")
    monkeypatch.setenv("AUTO_RESPONDER_PRICE_CHANGE", "0.5")
    assert responder_from_env() == Responder(seed=42, out_of_stock=0.1, no_reply=0, price_change=0.5)
