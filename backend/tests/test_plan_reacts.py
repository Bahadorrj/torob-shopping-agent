import datetime as dt
from zoneinfo import ZoneInfo

from test_alternatives import alternatives
from test_inquiries import AZAR_SHOP, MAHIS, MANSA, MANSA_SHOP, PAKYAR, compose, confirm, events, ids, new_session, reply
from test_visit_plan import ALADDIN

from pasazhgard.routing import Route

MAHIS_SHOP = "shop_9f2dc82937bde15452981294"  # چارسو, about 90 m from Aladdin
PAKYAR_SHOP = "shop_4934392f0e4fefe1526308c6"  # علاالدین, floor 5
VIVAN_SHOP = "shop_c060bc5ea37b78e00ece4bdb"  # علاالدین, زیر همکف
R50I_NC = "product_13f930f4c1400c7ab7bfa61f"
R50I_NC_MAHIS = "offer_535b9e046ebcc4f423d82bec"  # نیین ماهیس, declares installments
R50I_NC_MANSA = "offer_6cd696a9dc02e7fdaf8be5a3"  # دیسیلا مانسا
R50I_NC_VIVAN = "offer_f6ad28fb7b34220f8a126e25"  # نیکورا ویوان


def plan(client, sid, *shops, status=200, **params):
    r = client.get("/visit-plan", params={"shop_id": list(shops), "session_id": sid, **ALADDIN, **params})
    assert r.status_code == status, r.text
    return r.json()


def order(p):
    return [s["shop_id"] for s in p["stops"]]


def test_confirmed_shops_move_up_with_a_badge_and_time(client, clock, now):
    sid = new_session(client)
    mansa, pakyar, mahis = ids(confirm(client, sid, *ids(compose(client, sid, MANSA, PAKYAR, MAHIS))))
    shops = (MAHIS_SHOP, PAKYAR_SHOP, MANSA_SHOP)
    # Aladdin by floor, then the next pasaj over
    before = plan(client, sid, *shops)
    assert order(before) == [MANSA_SHOP, PAKYAR_SHOP, MAHIS_SHOP]
    assert [s["inquiry"]["status"] for s in before["stops"]] == ["sent", "sent", "sent"]
    assert before["stops"][0]["inquiry"]["inquiry_id"] == mansa

    clock(now + dt.timedelta(minutes=1))
    reply(client, mahis, available="yes")
    after = plan(client, sid, *shops)
    assert order(after) == [MAHIS_SHOP, MANSA_SHOP, PAKYAR_SHOP]
    first = after["stops"][0]["inquiry"]
    assert (first["inquiry_id"], first["status"], first["replied_at"]) == (mahis, "confirmed", "2026-10-21T12:01:00+03:30")
    assert pakyar in [s["inquiry"]["inquiry_id"] for s in after["stops"]]


def test_without_a_session_stops_carry_no_inquiry(client):
    stops = client.get("/visit-plan", params={"shop_id": [MANSA_SHOP], **ALADDIN}).json()["stops"]
    assert stops[0]["inquiry"] is None
    plan(client, "nope", MANSA_SHOP, status=404)


def test_an_accepted_alternative_takes_the_stop_it_stands_in_for(client, clock, now):
    sid = new_session(client)
    [mansa] = ids(confirm(client, sid, *ids(compose(client, sid, MANSA))))
    clock(now + dt.timedelta(minutes=3))
    silent = plan(client, sid, MAHIS_SHOP, MANSA_SHOP)
    assert [(s["shop_id"], s["inquiry"] and s["inquiry"]["status"]) for s in silent["stops"]] == [(MANSA_SHOP, "no_reply"), (MAHIS_SHOP, None)]
    # آذرنوش دیسیس, floor 2 of the same pasaj
    first = alternatives(client, sid, mansa)["alternatives"][0]
    [draft] = ids(compose(client, sid, first["offer_id"], instead_of=mansa))
    # a draft is not accepted yet
    assert order(plan(client, sid, MAHIS_SHOP, MANSA_SHOP)) == [MANSA_SHOP, MAHIS_SHOP]
    confirm(client, sid, draft)
    swapped = plan(client, sid, MAHIS_SHOP, MANSA_SHOP)
    assert order(swapped) == [AZAR_SHOP, MAHIS_SHOP]
    assert (swapped["stops"][0]["inquiry"]["inquiry_id"], swapped["stops"][0]["inquiry"]["status"]) == (draft, "sent")
    # the shop it stands in for answers after all: it is back
    reply(client, mansa, available="yes")
    assert order(plan(client, sid, MAHIS_SHOP, MANSA_SHOP)) == [MANSA_SHOP, MAHIS_SHOP]


def test_the_agent_asks_an_alternative_in_place_of_the_inquiry_that_fell_through(agent, client, clock, now):
    sid = agent.session_id
    [mansa] = ids(confirm(client, sid, *ids(compose(client, sid, MANSA))))
    clock(now + dt.timedelta(minutes=3))
    first = alternatives(client, sid, mansa)["alternatives"][0]
    agent.script(agent.brief(), agent.call("contact_seller", offer_ids=[first["offer_id"]], instead_of=mansa), "پیش‌نویس آماده است.")

    [draft] = agent.turn("از این یکی بپرس").blocks[0]["inquiries"]

    assert draft["instead_of"] == mansa
    confirm(client, sid, draft["inquiry_id"])
    assert order(plan(client, sid, MAHIS_SHOP, MANSA_SHOP)) == [AZAR_SHOP, MAHIS_SHOP]


def test_an_alternative_stands_in_for_an_inquiry_of_the_same_session(client):
    sid, other = new_session(client), new_session(client)
    [mansa] = ids(confirm(client, sid, *ids(compose(client, sid, MANSA))))
    compose(client, other, MAHIS, instead_of=mansa, status=404)
    compose(client, sid, MAHIS, PAKYAR, instead_of=mansa, status=422)


def test_a_confirmed_price_shows_its_difference_and_is_checked_against_the_budget(client):
    sid = new_session(client)
    client.patch(f"/sessions/{sid}", json={"brief": {"budget": {"max_per_item_toman": 3_600_000}}})
    mansa, mahis = ids(confirm(client, sid, *ids(compose(client, sid, MANSA, MAHIS))))
    # listed at 3,500,000, within the budget
    reply(client, mansa, latest_price_toman=3_700_000)
    reply(client, mansa, available="yes")
    stops = {s["shop_id"]: s["inquiry"] for s in plan(client, sid, MANSA_SHOP, MAHIS_SHOP)["stops"]}
    confirmed = stops[MANSA_SHOP]
    assert (confirmed["listed_price_toman"], confirmed["latest_price_toman"], confirmed["price_delta_toman"]) == (3_500_000, 3_700_000, 200_000)
    assert confirmed["over_budget"] is True
    # no price from the seller yet: the listed 3,044,000 counts
    silent = stops[MAHIS_SHOP]
    assert (silent["listed_price_toman"], silent["price_delta_toman"], silent["over_budget"]) == (3_044_000, None, False)


class CountingRouter:
    def __init__(self):
        self.legs = []

    def route(self, a, b, mode):
        self.legs.append((a, b, mode))
        return Route(distance_m=1000, duration_min=10, source="neshan")


TUESDAY_15 = dt.datetime(2026, 10, 20, 15, 0, tzinfo=ZoneInfo("Asia/Tehran"))


def test_the_plan_is_pushed_over_sse_on_replies_no_reply_closed_and_alternatives(client, clock):
    from pasazhgard.api import app, get_router

    router, saved = CountingRouter(), app.dependency_overrides[get_router]
    app.dependency_overrides[get_router] = lambda: router
    try:
        clock(TUESDAY_15)
        sid = new_session(client)
        mahis, mansa, vivan = ids(compose(client, sid, R50I_NC_MAHIS, R50I_NC_MANSA, R50I_NC_VIVAN))
        confirm(client, sid, mansa)
        clock(TUESDAY_15 + dt.timedelta(seconds=90))
        confirm(client, sid, mahis)
        # a second before the silent shop turns no_reply
        clock(TUESDAY_15 + dt.timedelta(seconds=119))
        params = {"shop_id": [MAHIS_SHOP, MANSA_SHOP, VIVAN_SHOP], "session_id": sid, **ALADDIN}
        with client.stream("GET", "/visit-plan/stream", params=params) as r:
            assert "no-transform" in r.headers["cache-control"]
            updates = events(r)
            first = next(updates)
            assert statuses(first) == {MAHIS_SHOP: "sent", MANSA_SHOP: "sent", VIVAN_SHOP: None}
            assert statuses(next(updates))[MANSA_SHOP] == "no_reply"
            reply(client, mahis, available="yes")
            confirmed = next(updates)
            assert (order(confirmed)[0], statuses(confirmed)[MAHIS_SHOP]) == (MAHIS_SHOP, "confirmed")
            # نیکورا ویوان opens at 16:00 on Tuesdays
            confirm(client, sid, vivan)
            assert statuses(next(updates))[VIVAN_SHOP] == "closed"
            clock(TUESDAY_15 + dt.timedelta(minutes=3))
            alternative = alternatives(client, sid, mansa)["alternatives"][0]
            confirm(client, sid, *ids(compose(client, sid, alternative["offer_id"], instead_of=mansa)))
            swapped = next(updates)
            assert statuses(swapped) == {MAHIS_SHOP: "confirmed", AZAR_SHOP: "sent", VIVAN_SHOP: "closed"}
            # the trip leaves when the stream opened, so a ticking clock pushes nothing
            assert swapped["depart_at"] == first["depart_at"]
        # each leg is routed once per stream, not on every poll
        assert len(router.legs) == len(set(router.legs))
    finally:
        app.dependency_overrides[get_router] = saved


def statuses(p):
    return {s["shop_id"]: s["inquiry"] and s["inquiry"]["status"] for s in p["stops"]}


def test_the_plan_stream_needs_a_session(client):
    params = {"shop_id": [MAHIS_SHOP], **ALADDIN}
    # without one the plan never changes; streaming it would poll for nothing
    for query, status in ((params, 422), ({**params, "session_id": "nope"}, 404)):
        with client.stream("GET", "/visit-plan/stream", params=query) as r:
            assert r.status_code == status


def test_anchor_scenario_a(client, clock, embedder):
    from pasazhgard.api import app, get_embedder

    # Tuesday 15:00; نیکورا ویوان opens at 16:00 on Tuesdays
    clock(dt.datetime(2026, 10, 20, 15, 0, tzinfo=ZoneInfo("Asia/Tehran")))
    jomhouri = {"lat": 35.6955, "lon": 51.4135}
    sid = new_session(client)
    # "a bluetooth headset for the gym, not sure which model; going to Jomhouri this evening, installments preferred",
    # then the two chip answers: budget and in-ear
    brief = {
        "need": "هندزفری بلوتوثی ورزشی",
        "use": "باشگاه",
        "features": ["توگوشی"],
        "budget": {"max_per_item_toman": 5_000_000},
        "origin": jomhouri,
        "area": {"radius_m": 1000},
        "visit_window": {"date": "2026-10-20", "earliest_arrival": "17:00:00"},
        "payment": {"kind": "installment"},
    }
    assert client.patch(f"/sessions/{sid}", json={"brief": brief}).status_code == 200
    at_17 = {**jomhouri, "radius_m": 1000, "max_per_item_toman": 5_000_000, "payment": "installment", "arrival": "2026-10-20T17:00:00+03:30"}

    app.dependency_overrides[get_embedder] = lambda: embedder
    try:
        shortlist = client.get("/products/suggest", params={"need": brief["need"], **at_17}).json()["models"]
    finally:
        app.dependency_overrides[get_embedder] = lambda: None
    top = [m["product_id"] for m in shortlist][:2]
    assert top[0] == R50I_NC and len(shortlist) >= 2

    compared = client.patch(f"/sessions/{sid}", json={"step": {"kind": "compare", "product_ids": top}}).json()["results"]
    assert [p["product_id"] for p in compared["products"]] == top

    sellers = client.patch(f"/sessions/{sid}", json={"step": {"kind": "sellers", "product_id": R50I_NC}}).json()["results"]
    # installments declared vs "ask them"
    declared = {s["offer_id"] for s in sellers["sellers"]}
    ask_them = {s["offer_id"] for s in sellers["ask_them"]}
    assert R50I_NC_MAHIS in declared and {R50I_NC_MANSA, R50I_NC_VIVAN} <= ask_them

    mahis, mansa, vivan = ids(compose(client, sid, R50I_NC_MAHIS, R50I_NC_MANSA, R50I_NC_VIVAN))
    sent = confirm(client, sid, mahis, mansa, vivan)["inquiries"]
    assert [i["status"] for i in sent] == ["sent", "sent", "closed"]
    # one confirms a new price, listed at 4,499,000; one stays silent
    reply(client, mahis, latest_price_toman=5_200_000, available="yes")
    clock(dt.datetime(2026, 10, 20, 15, 3, tzinfo=ZoneInfo("Asia/Tehran")))

    alternative = alternatives(client, sid, mansa)["alternatives"][0]
    assert (alternative["shop_id"], alternative["same_pasaj"]) == (AZAR_SHOP, True)
    confirm(client, sid, *ids(compose(client, sid, alternative["offer_id"], instead_of=mansa)))

    updated = plan(client, sid, MAHIS_SHOP, MANSA_SHOP, VIVAN_SHOP, **jomhouri, depart_at="2026-10-20T17:00:00+03:30")
    stops = [(s["shop_id"], s["inquiry"]["status"], s["open_at_eta"]) for s in updated["stops"]]
    # the confirmed shop first, then Aladdin by floor with the alternative in the silent shop's place
    assert stops == [(MAHIS_SHOP, "confirmed", True), (VIVAN_SHOP, "closed", True), (AZAR_SHOP, "sent", True)]
    confirmed = updated["stops"][0]["inquiry"]
    assert (confirmed["listed_price_toman"], confirmed["latest_price_toman"], confirmed["price_delta_toman"]) == (4_499_000, 5_200_000, 701_000)
    assert confirmed["over_budget"] is True and confirmed["replied_at"] == "2026-10-20T15:00:00+03:30"

    r = client.get(f"/shops/{AZAR_SHOP}/directions", params=jomhouri)
    assert r.json()["last_leg"] == {"pasaj": "علاالدین", "landmark": "رو‌به‌روی پاساژ چهارسو", "floor": "۲", "unit": "۲۱۶"}
