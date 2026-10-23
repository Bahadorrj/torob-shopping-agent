import datetime as dt
import json

from test_inquiries import AZAR, MANSA, compose, confirm, events, ids, new_session, reply, sent


def watch(client, sid):
    """Opens the session's inquiry stream as a tracker does, then reads the agent's thread."""
    with client.stream("GET", f"/sessions/{sid}/inquiries/stream") as r:
        next(events(r))
    return client.get(f"/sessions/{sid}/messages").json()


def fallbacks(thread):
    """The alternatives blocks in the thread, with the assistant line that comes with each."""
    calls = {c["id"]: m for m in thread if m["role"] == "assistant" for c in m.get("toolCalls", [])}
    blocks = [json.loads(m["content"]) for m in thread if m["role"] == "tool"]
    tools = [m for m in thread if m["role"] == "tool"]
    return [(calls[t["toolCallId"]]["content"], b) for t, b in zip(tools, blocks) if b["block"] == "alternatives"]


def test_unavailable_posts_the_top_alternatives_without_a_user_turn(client):
    sid, [mansa] = sent(client, MANSA)
    assert fallbacks(watch(client, sid)) == []
    reply(client, mansa, available="no")
    [(text, block)] = fallbacks(watch(client, sid))
    assert "دیسیلا مانسا" in text
    assert (block["inquiry_id"], block["reason"]) == (mansa, "unavailable")
    assert [a["shop_name"] for a in block["alternatives"]] == ["آذرنوش دیسیس", "نیکورا ویوان"]
    assert all(a["tradeoff"] for a in block["alternatives"])


def test_no_reply_posts_once_however_often_it_is_seen(client, clock, now):
    sid, [mansa] = sent(client, MANSA)
    clock(now + dt.timedelta(minutes=3))
    first = watch(client, sid)
    assert [b["reason"] for _, b in fallbacks(first)] == ["no_reply"]
    assert watch(client, sid) == first


def test_closed_posts_alternatives(client, clock, now):
    # آذرنوش دیسیس closes at 18:00
    clock(now.replace(hour=19))
    sid = new_session(client)
    confirm(client, sid, *ids(compose(client, sid, AZAR)))
    assert [b["reason"] for _, b in fallbacks(watch(client, sid))] == ["closed"]


def test_a_reply_without_availability_times_out_and_falls_back(client, clock, now):
    sid, [mansa] = sent(client, MANSA)
    clock(now + dt.timedelta(minutes=1))
    assert reply(client, mansa, latest_price_toman=3_400_000)["status"] == "replied"
    clock(now + dt.timedelta(minutes=2, seconds=30))
    assert fallbacks(watch(client, sid)) == []
    clock(now + dt.timedelta(minutes=4))
    [(_, block)] = fallbacks(watch(client, sid))
    assert block["reason"] == "no_reply"
    [inquiry] = client.get(f"/sessions/{sid}/inquiries").json()["inquiries"]
    # the wait runs from the seller's last reply, and the price they gave stays
    assert inquiry["events"][-1]["at"] == (now + dt.timedelta(minutes=3)).isoformat()
    assert inquiry["reply"]["latest_price_toman"] == 3_400_000


def test_the_next_turn_keeps_the_posted_message(agent, client):
    sid, [mansa] = sent(client, MANSA)
    reply(client, mansa, available="no")
    agent.session_id, agent.history = sid, watch(client, sid)
    agent.turn("هدفون")
    thread = client.get(f"/sessions/{sid}/messages").json()
    assert len(fallbacks(thread)) == 1
    assert [m["content"] for m in thread if m["role"] == "user"] == ["هدفون"]
