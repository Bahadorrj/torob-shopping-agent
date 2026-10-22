import json

ANKER = "product_92ac53fa75e18e8e73f20b56"
MANSA = "offer_948daebb31460ccf0b260704"  # دیسیلا مانسا: 3,500,000
MANSA_SHOP = "shop_e31a5b73908ea869f50af78e"
MANUSH = "offer_73254108e9f0882302b30908"  # دیسآرا مانوش: no price
PAKYAR = "offer_3c3d14695e8beea205c20a8c"  # دیسورا پاکیار
MAHIS = "offer_4482530cb944bbe32546da26"  # نیین ماهیس


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
    # the seller sees nothing before consent
    assert inbox(client, MANSA_SHOP)["inquiries"] == []


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
