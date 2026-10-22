import datetime as dt

from test_inquiries import AZAR, MANSA, compose, confirm, ids, new_session, reply, sent

ANKER_TITLE = "هدفون بلوتوثی انکر Soundcore R50i مدل A3949"


def alternatives(client, sid, inquiry_id, status=200):
    r = client.get(f"/sessions/{sid}/inquiries/{inquiry_id}/alternatives")
    assert r.status_code == status, r.text
    return r.json()


def lines(block):
    return [(a["shop_name"], a["tradeoff"]) for a in block["alternatives"]]


def test_unavailable_brings_up_the_same_product_in_the_same_pasaj_first(client):
    # دیسیلا مانسا is in علاالدین, listed at 3,500,000
    sid, [mansa] = sent(client, MANSA)
    reply(client, mansa, available="no")
    block = alternatives(client, sid, mansa)
    assert (block["inquiry_id"], block["reason"]) == (mansa, "unavailable")
    # open shops of the same pasaj, nearest first; دیسورا پاکیار is nearer but its hours are not recorded
    assert lines(block) == [
        ("آذرنوش دیسیس", "۲۰۰ هزار تومان ارزان‌تر، همین پاساژ، الان باز است"),
        ("نیکورا ویوان", "۱٫۸ میلیون تومان ارزان‌تر، همین پاساژ، الان باز است"),
    ]
    first = block["alternatives"][0]
    assert first["kind"] == "same_product"
    assert (first["product_id"], first["product_title"]) == ("product_92ac53fa75e18e8e73f20b56", ANKER_TITLE)
    assert (first["price_toman"], first["price_delta_toman"], first["same_pasaj"], first["open_now"]) == (3_300_000, -200_000, True, True)
    assert first["distance_m"] == 9


def test_only_an_inquiry_that_fell_through_has_alternatives(client):
    sid, [mansa] = sent(client, MANSA)
    alternatives(client, sid, mansa, status=409)
    alternatives(client, new_session(client), mansa, status=404)


def test_no_reply_and_closed_bring_up_alternatives_too(client, clock, now):
    sid, [mansa] = sent(client, MANSA)
    clock(now + dt.timedelta(minutes=3))
    block = alternatives(client, sid, mansa)
    assert (block["reason"], [a["shop_name"] for a in block["alternatives"]]) == ("no_reply", ["آذرنوش دیسیس", "نیکورا ویوان"])
    # آذرنوش دیسیس closes at 18:00; نیکورا ویوان at 19:45
    clock(now.replace(hour=19))
    sid = new_session(client)
    [azar] = ids(confirm(client, sid, *ids(compose(client, sid, AZAR))))
    block = alternatives(client, sid, azar)
    assert block["reason"] == "closed"
    assert lines(block) == [
        ("دیسیلا مانسا", "۲۰۰ هزار تومان گران‌تر، همین پاساژ، الان باز است"),
        ("نیکورا ویوان", "۱٫۶ میلیون تومان ارزان‌تر، همین پاساژ، الان باز است"),
    ]
