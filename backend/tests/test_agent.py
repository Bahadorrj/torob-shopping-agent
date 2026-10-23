import json

import pytest
from langchain_core.messages import AIMessage

ANKER = "product_92ac53fa75e18e8e73f20b56"
ANKER_NC = "product_13f930f4c1400c7ab7bfa61f"
MANSA = "offer_948daebb31460ccf0b260704"  # دیسیلا مانسا in Aladdin: 3,500,000
MAHIS = "offer_4482530cb944bbe32546da26"
CHEAPEST_SHOP = "shop_c060bc5ea37b78e00ece4bdb"  # نیکورا ویوان: 1,690,000, the cheapest Anker seller


def kinds(turn):
    return [b.get("block") for b in turn.blocks]


def test_without_a_model_free_text_gets_search_results_and_template_text(agent):
    turn = agent.turn("هدفون")

    assert kinds(turn) == ["product_cards"]
    assert turn.blocks[0]["items"]
    assert "در دسترس نیست" in turn.text


def test_without_a_model_an_empty_search_says_so(agent):
    turn = agent.turn("یخچال ساید بای ساید")

    assert turn.blocks[0]["items"] == []
    assert "پیدا نشد" in turn.text


def test_a_turn_patches_the_brief_from_the_users_words(agent, client):
    agent.script(
        agent.brief(
            need="هندزفری بی‌سیم",
            area={"name": "جمهوری"},
            budget={"max_total_toman": 2_000_000},
            visit_window={"earliest_arrival": "17:00"},
            payment={"kind": "installment"},
            quantity=2,
        ),
        "باشه.",
    )

    agent.turn("دو تا هندزفری بی‌سیم تا ۲ میلیون، قسطی، امروز ساعت ۵ میرم جمهوری")

    brief = client.get(f"/sessions/{agent.session_id}").json()["brief"]
    assert brief["need"] == "هندزفری بی‌سیم"
    assert brief["area"]["name"] == "جمهوری"
    assert brief["budget"]["max_total_toman"] == 2_000_000
    assert brief["visit_window"]["earliest_arrival"] == "17:00:00"
    assert brief["payment"]["kind"] == "installment"
    assert brief["items"][0]["quantity"] == 2


def test_a_patch_keeps_the_fields_the_user_did_not_mention(agent, client):
    agent.script(agent.brief(area={"pasaj": "علاالدین"}), "باشه.", agent.brief(budget={"max_total_toman": 3_000_000}), "باشه.")

    agent.turn("پاساژ علاالدین")
    agent.turn("تا ۳ میلیون")

    brief = client.get(f"/sessions/{agent.session_id}").json()["brief"]
    assert (brief["area"]["pasaj"], brief["budget"]["max_total_toman"]) == ("علاالدین", 3_000_000)


def test_a_turn_patches_the_priority(agent, client):
    agent.script(agent.brief(priority="closest"), "باشه.")

    agent.turn("نزدیک‌ترین رو میخوام")

    assert client.get(f"/sessions/{agent.session_id}").json()["brief"]["priority"] == "closest"


def test_a_turn_patches_the_travel_mode(agent, client):
    agent.script(agent.brief(travel_mode="car"), "باشه.")

    agent.turn("با ماشین میرم")

    assert client.get(f"/sessions/{agent.session_id}").json()["brief"]["travel_mode"] == "car"


def test_a_turn_turns_on_a_must_have_and_keeps_the_others(agent, client):
    # the "با گارانتی" suggestion chip sends "فقط با گارانتی"
    agent.script(agent.brief(must_have={"test_in_presence": True}), "باشه.", agent.brief(must_have={"warranty": True}), "باشه.")

    agent.turn("باید جلوی خودم تست کنم")
    agent.turn("فقط با گارانتی")

    must_have = client.get(f"/sessions/{agent.session_id}").json()["brief"]["must_have"]
    assert must_have == {"warranty": True, "test_in_presence": True, "fast_delivery": False}


def test_a_turn_can_turn_off_a_must_have(agent, client):
    agent.script(agent.brief(must_have={"fast_delivery": True}), "باشه.", agent.brief(must_have={"fast_delivery": False}), "باشه.")

    agent.turn("ارسال سریع میخوام")
    agent.turn("ارسال سریع لازم نیست")

    assert client.get(f"/sessions/{agent.session_id}").json()["brief"]["must_have"]["fast_delivery"] is False


def test_tool_results_stream_as_blocks_before_the_text(agent):
    agent.script(agent.brief(need="هدفون"), agent.call("search_products", query="هدفون انکر"), "این‌ها را پیدا کردم.")

    turn = agent.turn("هدفون انکر می‌خوام")

    assert kinds(turn) == ["product_cards"]
    assert ANKER in [i["product_id"] for i in turn.blocks[0]["items"]]
    assert turn.text == "این‌ها را پیدا کردم."
    types = [e["type"] for e in turn.events]
    assert types.index("TOOL_CALL_RESULT") < types.index("TEXT_MESSAGE_CONTENT")


def test_every_block_type_carries_its_tool_output(agent):
    agent.script(
        agent.brief(),
        agent.call("compare_products", product_ids=[ANKER, ANKER_NC]),
        agent.call("find_sellers", product_id=ANKER),
        agent.call("compare_sellers", product_id=ANKER, offer_ids=[MANSA, MAHIS]),
        "مقایسه آماده است.",
    )

    turn = agent.turn("این دو تا رو مقایسه کن و فروشنده‌هاش رو نشون بده")

    compare, sellers, seller_compare = turn.blocks
    assert compare["block"] == "compare_table"
    assert [p["product_id"] for p in compare["products"]] == [ANKER, ANKER_NC]
    assert sellers["block"] == "seller_list"
    assert sellers["sellers"][0]["shop_id"] == CHEAPEST_SHOP
    assert seller_compare["block"] == "seller_compare"
    assert [s["shop_name"] for s in seller_compare["sellers"]] == ["دیسیلا مانسا", "نیین ماهیس"]


def test_tools_read_the_brief_patched_in_the_same_turn(agent):
    agent.script(agent.brief(area={"pasaj": "علاالدین"}), agent.call("find_sellers", product_id=ANKER), "فروشنده‌های علاالدین.")

    turn = agent.turn("فروشنده‌های این هدفون توی علاالدین")

    assert {s["pasaj"] for s in turn.blocks[0]["sellers"]} == {"علاالدین"}


def test_a_failed_tool_call_is_no_block_and_the_turn_goes_on(agent):
    agent.script(agent.brief(), agent.call("find_sellers", product_id="product_missing"), "این کالا را پیدا نکردم.")

    turn = agent.turn("فروشنده‌های این کالا")

    assert "block" not in turn.blocks[0]
    assert turn.text == "این کالا را پیدا نکردم."


def test_a_plain_text_tool_error_does_not_end_the_turn(agent):
    # no product_id: the tool node answers with a plain-text error, not JSON
    agent.script(agent.brief(), agent.call("find_sellers"), agent.call("ask_user", field="budget", question="بودجه چقدر است؟"))

    turn = agent.turn("فروشنده‌ها")

    assert kinds(turn) == ["chips"]


def test_a_missing_field_is_asked_as_chips_and_ends_the_turn(agent):
    # the script has no reply after the question: a further model call would fail the turn
    agent.script(agent.brief(need="هندزفری"), agent.call("ask_user", field="area", question="کجا می‌خواهید بروید؟"))

    turn = agent.turn("یه هندزفری می‌خوام")

    assert kinds(turn) == ["chips"]
    chips = turn.blocks[0]
    assert (chips["field"], chips["question"]) == ("area", "کجا می‌خواهید بروید؟")
    # covered areas and pasajs from the data, plus the user's location
    assert {"نزدیک من", "فردوسی", "علاالدین"} <= set(chips["options"])


def test_only_one_question_per_turn(agent):
    two = agent.call("ask_user", field="area", question="کجا؟")
    two.tool_calls.append({"name": "ask_user", "args": {"field": "payment", "question": "چطور پرداخت؟"}, "id": "second", "type": "tool_call"})
    agent.script(agent.brief(), two)

    turn = agent.turn("هندزفری")

    # the two calls run in parallel, so their results arrive in either order
    assert kinds(turn).count("chips") == 1
    assert {"error": "one question per turn"} in turn.blocks


def test_no_question_about_a_field_the_brief_already_has(agent):
    agent.script(
        agent.brief(area={"name": "فردوسی"}),
        agent.call("ask_user", field="area", question="کجا؟"),
        agent.call("search_products", query="هندزفری"),
        "نتیجه‌ها در فردوسی.",
    )

    turn = agent.turn("هندزفری توی فردوسی")

    assert kinds(turn) == [None, "product_cards"]


def test_the_thread_keeps_earlier_turns(agent):
    agent.script(agent.brief(), agent.call("search_products", query="هدفون"), "سلام!", agent.brief(), "بله.")

    agent.turn("سلام، هدفون")
    turn = agent.turn("هستی؟")

    # the client resends the whole thread; the checkpointer neither loses nor duplicates it
    snapshot = next(e for e in turn.events if e["type"] == "MESSAGES_SNAPSHOT")["messages"]
    assert [m["content"] for m in snapshot if m["role"] == "user"] == ["سلام، هدفون", "هستی؟"]
    assert len([m for m in snapshot if m["role"] == "tool"]) == 1


def test_a_price_from_tool_output_is_grounded(agent):
    agent.script(agent.brief(), agent.call("find_sellers", product_id=ANKER), "ارزان‌ترین ۱٬۶۹۰٬۰۰۰ تومان است.")

    agent.turn("ارزان‌ترین فروشنده؟")


@pytest.mark.parametrize(
    ("claim", "found"),
    [
        ("ارزان‌ترین ۱٬۵۰۰٬۰۰۰ تومان است.", "price 1500000"),
        ("حدود ۱.۲ میلیون تومان است.", "price 1200000"),
        # the model code A3949 in the tool output is no price
        ("ارزان‌ترین ۳۹۴۹ تومان است.", "price 3949"),
        (f"فروشگاه {CHEAPEST_SHOP[:-1]}0 ارزان‌تر است.", "shop shop_"),
        # a shop of the data that this turn's tools did not return
        ("نیکورا نیکان ارزان‌تر است.", "shop نیکورا نیکان"),
        # no seller confirmed stock
        ("این هدفون موجود است.", "in stock"),
    ],
)
def test_an_ungrounded_price_shop_or_stock_claim_fails_the_turn(agent, claim, found):
    agent.script(agent.brief(), agent.call("find_sellers", product_id=ANKER), claim)

    with pytest.raises(AssertionError, match=found):
        agent.turn("ارزان‌ترین فروشنده؟")


def test_a_shop_named_in_tool_output_is_grounded(agent):
    agent.script(agent.brief(), agent.call("find_sellers", product_id=ANKER), "نیکورا ویوان ارزان‌ترین است.")

    agent.turn("ارزان‌ترین فروشنده؟")


def test_stock_is_grounded_only_for_the_shop_that_confirmed_it(agent, client):
    from test_inquiries import compose, confirm, ids, reply

    mansa, _ = ids(confirm(client, agent.session_id, *ids(compose(client, agent.session_id, MANSA, MAHIS))))
    reply(client, mansa, available="yes")
    agent.script(agent.brief(), agent.call("get_inquiries"), "دیسیلا مانسا موجود دارد.", agent.brief(), agent.call("get_inquiries"), "نیین ماهیس موجود دارد.")

    agent.turn("کی جواب داد؟")
    with pytest.raises(AssertionError, match="in stock"):
        agent.turn("نیین ماهیس چی؟")


def test_the_quantity_the_user_states_applies_to_the_total_budget(agent):
    agent.script(
        agent.brief(quantity=2, budget={"max_total_toman": 3_000_000}),
        agent.call("find_sellers", product_id=ANKER),
        "فروشنده‌ها.",
    )

    turn = agent.turn("دو تا از این هدفون، روی هم تا ۳ میلیون")

    # 2 x 1,690,000 is over budget
    assert CHEAPEST_SHOP not in [s["shop_id"] for s in turn.blocks[0]["sellers"]]


def test_contact_seller_composes_drafts_the_user_must_send(agent, client):
    agent.script(agent.brief(), agent.call("contact_seller", offer_ids=[MANSA, MAHIS]), "پیش‌نویس‌ها آماده است؛ با دکمه ارسال بفرستید.")

    turn = agent.turn("از این دو فروشنده بپرس")

    [status] = turn.blocks
    assert status["block"] == "inquiry_status"
    assert [(i["shop_name"], i["status"]) for i in status["inquiries"]] == [("دیسیلا مانسا", "draft"), ("نیین ماهیس", "draft")]
    # nothing reaches a seller until the user's tap confirms through the REST path
    stored = client.get(f"/sessions/{agent.session_id}/inquiries").json()["inquiries"]
    assert {i["status"] for i in stored} == {"draft"}


def test_contact_seller_errors_are_for_the_model(agent):
    agent.script(
        agent.brief(),
        agent.call("contact_seller", offer_ids=["offer_missing"]),
        agent.call("contact_seller", offer_ids=[]),
        "نشد.",
    )

    turn = agent.turn("بپرس")

    assert [b.get("block") for b in turn.blocks] == [None, None]


def test_get_inquiries_shows_the_tracker_and_lets_the_agent_say_in_stock(agent, client):
    from test_inquiries import reply

    # MAHIS: the inquiry tests expect the Mansa console empty before they send
    [mahis] = [i["inquiry_id"] for i in client.post(f"/sessions/{agent.session_id}/inquiries", json={"offer_ids": [MAHIS]}).json()["inquiries"]]
    client.post(f"/sessions/{agent.session_id}/inquiries/confirm", json={"inquiry_ids": [mahis]})
    reply(client, mahis, available="yes")
    agent.script(agent.brief(), agent.call("get_inquiries"), "نیین ماهیس گفته موجود است.")

    turn = agent.turn("فروشنده‌ها چه گفتند؟")

    [status] = turn.blocks
    assert status["block"] == "inquiry_status"
    assert [(i["inquiry_id"], i["status"]) for i in status["inquiries"]] == [(mahis, "confirmed")]
ALADDIN = {"lat": 35.69483032610498, "lon": 51.41152782573596}
VIVAN = "shop_c060bc5ea37b78e00ece4bdb"  # علاالدین, زیر همکف
PAKYAR = "shop_4934392f0e4fefe1526308c6"  # علاالدین, floor 5
DISIS = "shop_81c53acd00d779578fff4a40"  # آذرنوش دیسیس: علاالدین, floor ۲, unit ۲۱۶


def test_plan_visit_shows_the_plan_from_the_briefs_origin(agent, client):
    client.patch(f"/sessions/{agent.session_id}", json={"brief": {"origin": ALADDIN, "travel_mode": "car"}})
    agent.script(agent.brief(), agent.call("plan_visit", shop_ids=[PAKYAR, VIVAN]), "برنامهٔ مراجعه آماده است.")

    turn = agent.turn("برنامهٔ رفتن به این دو فروشگاه رو بچین")

    plan = turn.blocks[0]
    assert plan["block"] == "visit_plan"
    assert (plan["origin"], plan["mode"]) == (ALADDIN, "car")
    # one pasaj, bottom floor first
    assert [s["shop_id"] for s in plan["stops"]] == [VIVAN, PAKYAR]


def test_plan_visit_without_an_origin_is_no_block(agent):
    agent.script(agent.brief(), agent.call("plan_visit", shop_ids=[VIVAN]), "موقعیت شما را ندارم.")

    turn = agent.turn("برنامهٔ رفتن")

    assert "block" not in turn.blocks[0]


def test_get_directions_shows_the_route_and_last_leg(agent, client):
    client.patch(f"/sessions/{agent.session_id}", json={"brief": {"origin": ALADDIN}})
    agent.script(agent.brief(), agent.call("get_directions", shop_id=DISIS), "مسیر آذرنوش دیسیس.")

    turn = agent.turn("چطور برم آذرنوش دیسیس؟")

    d = turn.blocks[0]
    assert (d["block"], d["shop_id"]) == ("directions", DISIS)
    assert d["route"]["source"] == "straight_line"
    assert d["last_leg"] == {"pasaj": "علاالدین", "landmark": "رو‌به‌روی پاساژ چهارسو", "floor": "۲", "unit": "۲۱۶"}


def test_find_alternatives_shows_where_else_to_ask_for_an_inquiry_that_fell_through(agent, client):
    from test_inquiries import reply

    sid = agent.session_id
    [draft] = client.post(f"/sessions/{sid}/inquiries", json={"offer_ids": [MANSA]}).json()["inquiries"]
    client.post(f"/sessions/{sid}/inquiries/confirm", json={"inquiry_ids": [draft["inquiry_id"]]})
    reply(client, draft["inquiry_id"], available="no")
    other = client.post("/sessions").json()["session_id"]
    agent.script(
        agent.brief(),
        agent.call("find_alternatives", inquiry_id=draft["inquiry_id"]),
        "این دو فروشنده را هم می‌شود پرسید.",
    )

    turn = agent.turn("موجود نداشت، حالا چی؟")

    alt = turn.blocks[0]
    assert (alt["block"], alt["inquiry_id"], alt["reason"]) == ("alternatives", draft["inquiry_id"], "unavailable")
    assert [a["shop_name"] for a in alt["alternatives"]] == ["آذرنوش دیسیس", "نیکورا ویوان"]
    # another session's inquiry is not this thread's
    agent.session_id = other
    agent.history = []
    agent.script(agent.brief(), agent.call("find_alternatives", inquiry_id=draft["inquiry_id"]), "پیدا نشد.")
    assert "block" not in agent.turn("جایگزین؟").blocks[0]


def test_seller_tools_show_the_price_a_seller_confirmed_in_this_session(agent, client):
    from test_inquiries import reply

    sid = agent.session_id
    [mahis] = [i["inquiry_id"] for i in client.post(f"/sessions/{sid}/inquiries", json={"offer_ids": [MAHIS]}).json()["inquiries"]]
    client.post(f"/sessions/{sid}/inquiries/confirm", json={"inquiry_ids": [mahis]})
    reply(client, mahis, latest_price_toman=3_100_000)
    agent.script(agent.brief(), agent.call("find_sellers", product_id=ANKER), agent.call("compare_sellers", product_id=ANKER, offer_ids=[MAHIS]), "این‌ها.")

    turn = agent.turn("فروشنده‌ها")

    sellers, [compared] = turn.blocks[0]["sellers"] + turn.blocks[0]["ask_them"], turn.blocks[1]["sellers"]
    [listed] = [s for s in sellers if s["offer_id"] == MAHIS]
    for row in (listed, compared):
        assert (row["latest_price"]["status"], row["latest_price"]["price_toman"]) == ("confirmed", 3_100_000)


def test_fetch_site_price_shows_the_website_price_in_the_tracker(agent, site):
    from test_site_price import CABLE, MAHDI, PAGE

    site({"https://mahdicable.ir/": PAGE}, {"price_toman": 580000})
    agent.script(agent.brief(), agent.call("fetch_site_price", shop_id=MAHDI, product_id=CABLE), "قیمت سایت را ببینید.")

    turn = agent.turn("قیمت سایتش چنده؟")

    [status] = turn.blocks
    assert status["block"] == "inquiry_status"
    assert status["inquiries"] == []
    assert [(p["shop_id"], p["status"], p["price_toman"]) for p in status["site_prices"]] == [(MAHDI, "found", 580000)]


def test_fetch_site_price_for_a_shop_without_a_website_is_for_the_model(agent):
    agent.script(agent.brief(), agent.call("fetch_site_price", shop_id=CHEAPEST_SHOP, product_id="product_92ac53fa75e18e8e73f20b56"), "سایت ندارد.")

    assert [b.get("block") for b in agent.turn("قیمت سایتش؟").blocks] == [None]


def test_a_question_in_prose_is_asked_again_as_chips(agent):
    agent.script(
        agent.brief(need="هندزفری"),
        "حداکثر بودجه‌تان برای هندزفری چقدر است؟",
        agent.call("ask_user", field="budget", question="حداکثر بودجه‌تان چقدر است؟"),
    )

    turn = agent.turn("یه هندزفری بلوتوثی برای باشگاه میخوام")

    assert kinds(turn) == ["chips"]
    assert turn.blocks[0]["question"] == "حداکثر بودجه‌تان چقدر است؟"
    # the prose question never reaches the user
    assert turn.text == ""


def test_a_prose_question_after_a_rejected_ask_is_replaced_by_a_statement(agent):
    # the brief has the area, so ask_user refuses it; the turn ends without a chip-less question
    agent.script(
        agent.brief(area={"name": "فردوسی"}),
        "کجا می‌روید؟",
        agent.call("ask_user", field="area", question="کجا؟"),
        "کجا می‌روید؟",
    )

    turn = agent.turn("هندزفری توی فردوسی")

    assert turn.text
    assert "؟" not in turn.text and "?" not in turn.text


def test_a_question_mark_before_the_last_sentence_is_no_question(agent):
    text = "مدل Buds? Pro را در https://torob.com/?q=buds ببینید."
    agent.script(agent.brief(), text)

    turn = agent.turn("هندزفری")

    assert kinds(turn) == []
    assert turn.text == text


def test_a_final_question_in_content_blocks_is_asked_again_as_chips(agent):
    agent.script(
        agent.brief(need="هندزفری"),
        AIMessage([{"type": "text", "text": "بودجه‌تان چقدر است؟ "}], id="q"),
        agent.call("ask_user", field="budget", question="بودجه‌تان چقدر است؟"),
    )

    turn = agent.turn("هندزفری")

    assert kinds(turn) == ["chips"]
    assert turn.text == ""


def test_a_refused_ask_keeps_the_reply_before_its_question(agent):
    reply = "این سه مدل برای باشگاه مناسب‌اند. «کجا می‌روید؟»"
    agent.script(agent.brief(area={"name": "فردوسی"}), reply, agent.call("ask_user", field="area", question="کجا؟"), reply)

    turn = agent.turn("هندزفری توی فردوسی")

    assert turn.text == "این سه مدل برای باشگاه مناسب‌اند."


def test_the_thread_reads_back_after_a_reload(agent, client):
    agent.script(agent.brief(), agent.call("search_products", query="هدفون"), "این‌ها را پیدا کردم.", agent.brief(), "بله.")
    agent.turn("هدفون")

    thread = client.get(f"/sessions/{agent.session_id}/messages").json()

    assert [m["role"] for m in thread] == ["user", "assistant", "tool", "assistant"]
    assert thread[2]["toolCallId"] == thread[1]["toolCalls"][0]["id"]
    assert json.loads(thread[2]["content"])["block"] == "product_cards"
    # the reloaded page sends the read-back thread on its next turn; nothing is lost or doubled
    agent.history = thread
    turn = agent.turn("هستی؟")
    snapshot = next(e for e in turn.events if e["type"] == "MESSAGES_SNAPSHOT")["messages"]
    assert [m["content"] for m in snapshot if m["role"] == "user"] == ["هدفون", "هستی؟"]
    assert len([m for m in snapshot if m["role"] == "tool"]) == 1


def test_a_session_without_a_thread_reads_back_empty(client):
    sid = client.post("/sessions").json()["session_id"]

    assert client.get(f"/sessions/{sid}/messages").json() == []


@pytest.mark.parametrize(
    ("field", "options"),
    [
        ("budget", ["تا ۱ میلیون تومان", "تا ۵ میلیون تومان", "تا ۲۰ میلیون تومان", "فرقی نمی‌کند"]),
        ("quantity", ["۱", "۲", "۳"]),
    ],
)
def test_a_question_the_model_gave_no_options_still_has_chips(agent, field, options):
    agent.script(agent.brief(), agent.call("ask_user", field=field, question="؟"))

    assert agent.turn("هندزفری").blocks[0]["options"] == options


def test_the_models_budget_options_win_over_the_default(agent):
    agent.script(agent.brief(), agent.call("ask_user", field="budget", question="؟", options=["تا ۲ میلیون تومان", "تا ۴ میلیون تومان"]))

    assert agent.turn("هندزفری").blocks[0]["options"] == ["تا ۲ میلیون تومان", "تا ۴ میلیون تومان"]


def test_a_use_question_without_options_goes_back_to_the_model(agent):
    agent.script(
        agent.brief(),
        agent.call("ask_user", field="use", question="برای چه کاری؟"),
        agent.call("ask_user", field="use", question="برای چه کاری؟", options=["ورزش", "تماس"]),
    )

    turn = agent.turn("هندزفری")

    assert turn.blocks == [{"error": "give 3-5 short options"}, {"block": "chips", "field": "use", "question": "برای چه کاری؟", "options": ["ورزش", "تماس"]}]


def test_a_radius_without_an_origin_does_not_fail_the_turn_and_asks_for_the_location(agent, client):
    agent.script(
        agent.brief(need="هندزفری", area={"radius_m": 1000}),
        agent.call("ask_user", field="origin", question="از کجا شروع می‌کنید؟"),
    )

    turn = agent.turn("هندزفری نزدیک من")

    assert kinds(turn) == ["chips"]
    assert turn.blocks[0]["field"] == "origin"
    assert turn.blocks[0]["options"][0] == "موقعیت من"
    assert {"فردوسی", "علاالدین"} <= set(turn.blocks[0]["options"])
    brief = client.get(f"/sessions/{agent.session_id}").json()["brief"]
    assert (brief["need"], brief["area"], brief["origin"]) == ("هندزفری", None, None)


def test_a_radius_with_an_origin_still_applies(agent, client):
    client.patch(f"/sessions/{agent.session_id}", json={"brief": {"origin": ALADDIN}})
    agent.script(agent.brief(area={"radius_m": 1000}), "باشه.")

    agent.turn("نزدیک من")

    assert client.get(f"/sessions/{agent.session_id}").json()["brief"]["area"]["radius_m"] == 1000


def test_the_origin_set_through_the_question_lets_the_visit_plan_come_back(agent, client):
    agent.script(
        agent.brief(),
        agent.call("plan_visit", shop_ids=[VIVAN]),
        agent.call("ask_user", field="origin", question="از کجا شروع می‌کنید؟"),
    )
    first = agent.turn("برنامهٔ رفتن به این فروشگاه")
    # the error for the model says to ask, and the question ends the turn
    assert kinds(first) == [None, "chips"]

    # the chip's tap patches the origin, then sends its text as the next turn
    client.patch(f"/sessions/{agent.session_id}", json={"brief": {"origin": ALADDIN}})
    agent.script(agent.brief(), agent.call("plan_visit", shop_ids=[VIVAN]), "برنامهٔ مراجعه آماده است.")
    second = agent.turn("مبدأ من: علاالدین")

    assert kinds(second) == ["visit_plan"]


def test_no_origin_question_when_the_brief_has_the_origin(agent, client):
    client.patch(f"/sessions/{agent.session_id}", json={"brief": {"origin": ALADDIN}})
    agent.script(
        agent.brief(),
        agent.call("ask_user", field="origin", question="از کجا؟"),
        agent.call("plan_visit", shop_ids=[VIVAN]),
        "آماده است.",
    )

    assert kinds(agent.turn("برنامهٔ رفتن")) == [None, "visit_plan"]


def test_a_shop_question_is_answered_with_shop_details(agent):
    agent.script(agent.brief(), agent.call("shop_details", shop_id=CHEAPEST_SHOP), "طبقه و ساعت کاری در کارت فروشگاه است.")

    turn = agent.turn("کدوم طبقه است؟ پنجشنبه بازه؟")

    [shop] = turn.blocks
    assert (shop["block"], shop["shop_id"], shop["name"]) == ("shop_details", CHEAPEST_SHOP, "نیکورا ویوان")
    assert [d["day"] for d in shop["hours"]["week"]][-2] == "thu"


def test_the_agent_reads_a_product_with_get_product(agent):
    agent.script(agent.brief(), agent.call("get_product", product_id=ANKER), "مشخصات در کارت کالا است.")

    [product] = agent.turn("مشخصات این هدفون چیه؟").blocks

    assert (product["block"], product["product_id"]) == ("product", ANKER)
    assert product["specs"]


def test_shop_details_and_get_product_say_not_found_to_the_model_only(agent):
    agent.script(agent.brief(), agent.call("shop_details", shop_id="shop_missing"), agent.call("get_product", product_id="product_missing"), "پیدا نشد.")

    assert [b.get("block") for b in agent.turn("این فروشگاه کجاست؟").blocks] == [None, None]


def test_find_sellers_leaves_out_the_area_lists_and_caps_category_only_for_the_model(agent, client):
    many = "product_0a040d1b11770040095cec15"  # 17 category-only shops
    agent.script(agent.brief(), agent.call("find_sellers", product_id=many), "فروشنده‌ها.")

    [sellers] = agent.turn("فروشنده‌های این کالا").blocks

    assert "areas" not in sellers and "pasajs" not in sellers
    full = client.get(f"/products/{many}/sellers").json()["category_only"]
    assert len(full) > 5
    assert sellers["category_only"] == full[:5]
