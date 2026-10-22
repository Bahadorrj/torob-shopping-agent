import datetime as dt
import json

ANKER = "product_92ac53fa75e18e8e73f20b56"
MANSA = "offer_948daebb31460ccf0b260704"  # دیسیلا مانسا: 3,500,000
MANSA_SHOP = "shop_e31a5b73908ea869f50af78e"
MANUSH = "offer_73254108e9f0882302b30908"  # دیسآرا مانوش: no price
PAKYAR = "offer_3c3d14695e8beea205c20a8c"  # دیسورا پاکیار
MAHIS = "offer_4482530cb944bbe32546da26"  # نیین ماهیس
AZAR = "offer_1700cc0225d2f15b0456b35a"  # آذرنوش دیسیس: open 10:30-18:00 on Wednesdays
AZAR_SHOP = "shop_81c53acd00d779578fff4a40"


def new_session(client):
    return client.post("/sessions").json()["session_id"]


def compose(client, sid, *offers, status=201, **body):
    r = client.post(f"/sessions/{sid}/inquiries", json={"offer_ids": list(offers), **body})
    assert r.status_code == status, r.text
    return r.json()


def inbox(client, shop_id):
    r = client.get(f"/console/shops/{shop_id}/inquiries")
    assert r.status_code == 200, r.text
    return r.json()


def test_compose_makes_drafts_and_sends_nothing(client):
    sid = new_session(client)
    drafts = compose(client, sid, MANSA, MAHIS)["inquiries"]
    assert [(d["shop_name"], d["status"]) for d in drafts] == [("دیسیلا مانسا", "draft"), ("نیین ماهیس", "draft")]
    mansa = drafts[0]
    assert (mansa["offer_id"], mansa["shop_id"], mansa["product_id"]) == (MANSA, MANSA_SHOP, ANKER)
    # one short Persian message asking every question
    for words in ("موجود", "قیمت امروز", "نگه", "اقساط"):
        assert words in mansa["message"]
    assert client.get(f"/sessions/{sid}/inquiries").json()["inquiries"] == drafts
    # the seller sees nothing before consent; other tests' inquiries may be there
    assert mansa["inquiry_id"] not in ids(inbox(client, MANSA_SHOP))


def confirm(client, sid, *ids, status=200):
    r = client.post(f"/sessions/{sid}/inquiries/confirm", json={"inquiry_ids": list(ids)})
    assert r.status_code == status, r.text
    return r.json()


def ids(status):
    return [i["inquiry_id"] for i in status["inquiries"]]


def test_consent_sends_drafts_to_the_seller_console(client, now):
    sid = new_session(client)
    mansa, mahis = ids(compose(client, sid, MANSA, MAHIS))
    # the user consents to one of the two drafts
    sent = confirm(client, sid, mansa)["inquiries"]
    assert [(i["inquiry_id"], i["status"]) for i in sent] == [(mansa, "sent"), (mahis, "draft")]
    assert sent[0]["channel"] == "seller_console" and sent[0]["simulated"] is True
    assert [e["status"] for e in sent[0]["events"]] == ["draft", "sent"]
    [seen] = [i for i in inbox(client, MANSA_SHOP)["inquiries"] if i["inquiry_id"] == mansa]
    assert seen["message"] == sent[0]["message"]
    # a second tap sends nothing twice
    assert confirm(client, sid, mansa)["inquiries"] == sent


def test_consent_is_scoped_to_the_session(client):
    sid, other = new_session(client), new_session(client)
    [draft] = ids(compose(client, sid, MANSA))
    confirm(client, other, draft, status=404)
    confirm(client, "nope", draft, status=404)
    assert client.get(f"/sessions/{sid}/inquiries").json()["inquiries"][0]["status"] == "draft"


def test_at_most_three_inquiries_per_item(client):
    sid = new_session(client)
    compose(client, sid, MANSA, MAHIS, PAKYAR, MANUSH, status=422)
    compose(client, sid, MANSA, MAHIS)
    # composing again replaces the unsent drafts of that item
    first = ids(compose(client, sid, MANSA, MAHIS, PAKYAR))
    assert ids(client.get(f"/sessions/{sid}/inquiries").json()) == first
    confirm(client, sid, *first)
    # a fourth seller of the same item waits until one of the three settles
    compose(client, sid, MANUSH, status=409)
    # another session asks independently
    compose(client, new_session(client), MANUSH)


def sent(client, *offers):
    sid = new_session(client)
    return sid, ids(confirm(client, sid, *ids(compose(client, sid, *offers))))


def reply(client, inquiry_id, status=200, **body):
    r = client.post(f"/console/inquiries/{inquiry_id}/replies", json=body)
    assert r.status_code == status, r.text
    return r.json()


def test_quick_replies_map_to_the_parsed_reply(client, now):
    sid, [mansa] = sent(client, MANSA)
    assert reply(client, mansa, latest_price_toman=3_400_000)["status"] == "replied"
    assert reply(client, mansa, available="yes")["status"] == "confirmed"
    reply(client, mansa, hold_until="17:00")
    done = reply(client, mansa, installments=True)
    assert done["status"] == "confirmed"
    assert done["reply"] == {
        "available": "yes",
        "latest_price_toman": 3_400_000,
        "hold_until": "17:00:00",
        "installments": True,
        "notes": None,
        "confidence": 1.0,
    }
    # the per-shop timeline, with what the seller tapped
    assert [(e["status"], e["reply"]) for e in done["events"]] == [
        ("draft", None),
        ("sent", None),
        ("replied", {"latest_price_toman": 3_400_000}),
        ("confirmed", {"available": "yes"}),
        ("confirmed", {"hold_until": "17:00:00"}),
        ("confirmed", {"installments": True}),
    ]
    assert done["events"][-1]["at"] == now.isoformat()
    assert client.get(f"/sessions/{sid}/inquiries").json()["inquiries"] == [done]


def test_free_text_is_stored_as_is_and_unavailable_settles(client):
    _, [mansa] = sent(client, MANSA)
    text = "  فردا عصر بیاید، شاید برسد  "
    after = reply(client, mansa, text=text)
    assert (after["status"], after["reply"]["available"]) == ("replied", "unknown")
    assert after["events"][-1]["reply"] == {"text": text}
    assert reply(client, mansa, available="no")["status"] == "unavailable"


def test_only_sent_inquiries_take_replies(client):
    sid = new_session(client)
    [draft] = ids(compose(client, sid, MANSA))
    reply(client, draft, available="yes", status=409)
    reply(client, 10**9, available="yes", status=404)
    _, [mansa] = sent(client, MANSA)
    reply(client, mansa, status=422)
    reply(client, mansa, latest_price_toman=0, status=422)
    reply(client, mansa, available="maybe", status=422)


def events(response):
    for line in response.iter_lines():
        if line.startswith("data: "):
            yield json.loads(line.removeprefix("data: "))


def test_tracker_updates_over_sse(client):
    sid, [mansa] = sent(client, MANSA)
    with client.stream("GET", f"/sessions/{sid}/inquiries/stream") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        # the web proxy compresses, and so holds back, events unless told not to transform them
        assert "no-transform" in r.headers["cache-control"]
        updates = events(r)
        assert next(updates)["inquiries"][0]["status"] == "sent"
        reply(client, mansa, available="yes")
        assert next(updates)["inquiries"][0]["status"] == "confirmed"
    assert client.get(f"/sessions/nope/inquiries/stream").status_code == 404


def test_console_updates_over_sse(client):
    _, [mansa] = sent(client, MANSA)
    with client.stream("GET", f"/console/shops/{MANSA_SHOP}/inquiries/stream") as r:
        updates = events(r)
        assert next(updates)["inquiries"][0]["inquiry_id"] == mansa
        _, [newer] = sent(client, MANSA)
        assert next(updates)["inquiries"][0]["inquiry_id"] == newer


def seller_compare(client, *offers, **params):
    r = client.get(f"/products/{ANKER}/sellers/compare", params={"offer_id": list(offers), **params})
    assert r.status_code == 200, r.text
    return r.json()["sellers"]


def test_confirmed_reply_shows_in_seller_compare(client, now):
    sid, [mansa, _] = sent(client, MANSA, MAHIS)
    for body in ({"latest_price_toman": 3_400_000}, {"available": "yes"}, {"hold_until": "17:00"}, {"installments": True}):
        reply(client, mansa, **body)
    a, b, c = seller_compare(client, MANSA, MAHIS, MANUSH, session_id=sid)
    # the listed price stays beside the seller's price, which carries its source and time
    assert a["price_toman"] == 3_500_000
    assert a["latest_price"] == {"status": "confirmed", "price_toman": 3_400_000, "trust_level": "confirmed", "at": now.isoformat()}
    assert a["inquiry"] == {
        "inquiry_id": mansa,
        "status": "confirmed",
        "available": "yes",
        "latest_price_toman": 3_400_000,
        "hold_until": "17:00:00",
        "installments": True,
        "replied_at": now.isoformat(),
    }
    assert b["latest_price"]["status"] == "asked"
    assert (b["inquiry"]["status"], b["inquiry"]["available"], b["inquiry"]["replied_at"]) == ("sent", "unknown", None)
    assert (c["latest_price"]["status"], c["inquiry"]) == ("not_asked", None)
    # another session asked nothing
    assert seller_compare(client, MANSA, session_id=new_session(client))[0]["inquiry"] is None
    assert seller_compare(client, MANSA)[0]["latest_price"]["status"] == "not_asked"


def seller_list(client, sid, **brief):
    r = client.patch(f"/sessions/{sid}", json={"brief": brief, "step": {"kind": "sellers", "product_id": ANKER}})
    assert r.status_code == 200, r.text
    return r.json()["results"]


def names(rows):
    return [s["shop_name"] for s in rows]


def test_confirmed_price_and_installments_count_in_the_seller_list(client, now):
    sid, [mansa] = sent(client, MANSA)
    budget = {"max_per_item_toman": 3_450_000}
    # listed at 3,500,000 and no payment recorded
    assert "دیسیلا مانسا" not in names(seller_list(client, sid, budget=budget)["sellers"])
    assert "دیسیلا مانسا" in names(seller_list(client, sid, budget={}, payment={"kind": "installment"})["ask_them"])
    reply(client, mansa, latest_price_toman=3_400_000)
    reply(client, mansa, installments=True)
    result = seller_list(client, sid, budget=budget, payment={"kind": "installment"})
    [row] = [s for s in result["sellers"] if s["shop_name"] == "دیسیلا مانسا"]
    assert row["latest_price"] == {"status": "confirmed", "price_toman": 3_400_000, "trust_level": "confirmed", "at": now.isoformat()}
    assert row["inquiry"]["installments"] is True
    # a seller who says no installments is dropped
    reply(client, mansa, installments=False)
    assert "دیسیلا مانسا" not in names(seller_list(client, sid)["sellers"] + seller_list(client, sid)["ask_them"])


def test_the_hold_question_names_the_visit_time(client):
    sid = new_session(client)
    client.patch(f"/sessions/{sid}", json={"brief": {"visit_window": {"earliest_arrival": "17:00"}}})
    [draft] = compose(client, sid, MANSA, questions=["hold"])["inquiries"]
    assert "تا ساعت ۱۷:۰۰ برایم نگه می‌دارید؟" in draft["message"]
    assert "قیمت" not in draft["message"]


def statuses(client, sid):
    return [i["status"] for i in client.get(f"/sessions/{sid}/inquiries").json()["inquiries"]]


def test_unanswered_inquiries_turn_no_reply_after_n_minutes(client, clock, now):
    sid, [mansa, mahis] = sent(client, MANSA, MAHIS)
    reply(client, mahis, available="yes")
    clock(now + dt.timedelta(minutes=2) - dt.timedelta(seconds=1))
    assert statuses(client, sid) == ["sent", "confirmed"]
    clock(now + dt.timedelta(minutes=5))
    [late, answered] = client.get(f"/sessions/{sid}/inquiries").json()["inquiries"]
    assert (late["status"], answered["status"]) == ("no_reply", "confirmed")
    # the step happened when the wait ran out, not when someone looked
    assert late["events"][-1] == {"at": (now + dt.timedelta(minutes=2)).isoformat(), "status": "no_reply", "reply": None, "question": None}
    # a late reply still counts
    assert reply(client, mansa, available="yes")["status"] == "confirmed"


def test_a_closed_inquiry_sent_again_counts_among_the_three(client, clock, now):
    clock(now.replace(hour=19))
    sid = new_session(client)
    [azar] = ids(confirm(client, sid, *ids(compose(client, sid, AZAR))))
    confirm(client, sid, *ids(compose(client, sid, MANSA, MAHIS, PAKYAR)))

    r = client.post(f"/sessions/{sid}/inquiries/confirm", json={"inquiry_ids": [azar], "queue": True})

    assert r.status_code == 409, r.text
    [still] = [i for i in client.get(f"/sessions/{sid}/inquiries").json()["inquiries"] if i["inquiry_id"] == azar]
    assert still["status"] == "closed"


def test_closed_shops_are_not_sent_unless_queued_for_opening(client, clock, now):
    evening = now.replace(hour=19)
    clock(evening)
    sid = new_session(client)
    azar, mahis, pakyar = ids(compose(client, sid, AZAR, MAHIS, PAKYAR))
    # hours unknown is not closed, so pakyar is asked
    assert [i["status"] for i in confirm(client, sid, azar, mahis, pakyar)["inquiries"]] == ["closed", "sent", "sent"]
    assert azar not in ids(inbox(client, AZAR_SHOP))
    reply(client, azar, available="yes", status=409)
    r = client.post(f"/sessions/{sid}/inquiries/confirm", json={"inquiry_ids": [azar], "queue": True})
    assert r.json()["inquiries"][0]["status"] == "queued"
    # a queued message holds a place among the item's three
    compose(client, sid, MANUSH, status=409)
    clock(evening + dt.timedelta(hours=1))
    assert azar not in ids(inbox(client, AZAR_SHOP))
    # Thursday morning, once the shop opens
    opening = (now + dt.timedelta(days=1)).replace(hour=10, minute=30)
    clock(opening)
    [seen] = [i for i in inbox(client, AZAR_SHOP)["inquiries"] if i["inquiry_id"] == azar]
    assert (seen["inquiry_id"], seen["status"], seen["channel"]) == (azar, "sent", "seller_console")
    assert [(e["status"], e["at"]) for e in seen["events"]][1:] == [
        ("closed", evening.isoformat()),
        ("queued", evening.isoformat()),
        ("sent", opening.isoformat()),
    ]
