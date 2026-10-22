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


def fell_through(client, *offers, brief=None):
    """Ask these sellers; each says no. Returns the session and the inquiry ids."""
    sid = new_session(client)
    if brief:
        client.patch(f"/sessions/{sid}", json={"brief": brief})
    asked = ids(confirm(client, sid, *ids(compose(client, sid, *offers))))
    for i in asked:
        reply(client, i, available="no")
    return sid, asked


R60I_MANSA, R60I_VIVAN = "offer_a9baf081e171b41c21a13899", "offer_9daa56af1437834d44fd854c"


def test_then_a_similar_product_within_budget(client):
    # R60i NC: آذرنوش دیسیس lists it at 6,900,000, over the budget; the R50i models share specs with it
    sid, [mansa, _] = fell_through(client, R60I_MANSA, R60I_VIVAN, brief={"budget": {"max_per_item_toman": 4_500_000}})
    block = alternatives(client, sid, mansa)
    assert [(a["kind"], a["product_title"], a["shop_name"], a["tradeoff"]) for a in block["alternatives"]] == [
        ("similar_product", ANKER_TITLE, "آذرنوش دیسیس", "کالای مشابه، ۲٫۵ میلیون تومان ارزان‌تر، همین پاساژ، الان باز است"),
        (
            "similar_product",
            "هندزفری بلوتوثی انکر مدل Soundcore R50i NC A3959",
            "دیسورا پاکیار",
            "کالای مشابه، ۱٫۷ میلیون تومان ارزان‌تر، همین پاساژ",
        ),
    ]


def test_then_shops_of_the_category_to_ask(client):
    # AirPods Pro 2: two sellers, and no product of its category shares a spec with it
    sid, [_, vivan] = fell_through(client, "offer_63cd2cf47ed555bed5977e91", "offer_4b77afce6859bf4acaf35d5e")
    block = alternatives(client, sid, vivan)
    assert lines(block) == [
        ("دیسیلا مانسا", "این کالا را ثبت نکرده، بپرسید، همین پاساژ، الان باز است"),
        ("آذرنوش دیسیس", "این کالا را ثبت نکرده، بپرسید، همین پاساژ، الان باز است"),
    ]
    first = block["alternatives"][0]
    assert (first["kind"], first["offer_id"], first["price_toman"]) == ("category_only", None, None)


def test_then_fast_delivery_shops(client, clock, now):
    # a video recorder at 18:30: one shop of its category is left, and دیسان سرویار, which delivers fast, closed at 18:00
    clock(now.replace(hour=18, minute=30))
    sid, [farin, _] = fell_through(client, "offer_10a4d052d9ddce3891478a4a", "offer_8a62184c5cb6af8bec597e8f")
    block = alternatives(client, sid, farin)
    assert lines(block) == [
        ("روین آودیس", "این کالا را ثبت نکرده، بپرسید، ۴۷۳ متر فاصله، الان باز است"),
        ("دیسان سرویار", "۴۶۱ متر فاصله، الان بسته است، ارسال سریع دارد"),
    ]
    assert block["alternatives"][1]["kind"] == "fast_delivery"
