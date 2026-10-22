import datetime as dt
from zoneinfo import ZoneInfo

from test_inquiries import AZAR, AZAR_SHOP, MANSA, MANSA_SHOP, compose, confirm, events, ids, new_session, reply
from test_site_price import CABLE, MAHDI, PAGE, fetch
from test_visit_plan import ALADDIN, fake_router  # noqa: F401

MAHIS_SHOP = "shop_9f2dc82937bde15452981294"  # چارسو, open until 20:00
# آذرنوش دیسیس closes at 18:00 on Wednesdays
WEDNESDAY = dt.datetime(2026, 10, 21, 17, 49, 59, tzinfo=ZoneInfo("Asia/Tehran"))


def plan(client, sid, *shops, **params):
    r = client.get("/visit-plan", params={"shop_id": list(shops), "session_id": sid, **ALADDIN, **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_shop_closing_before_the_eta_warns_with_the_latest_departure_and_a_swap(client, fake_router):  # noqa: F811
    sid = new_session(client)
    confirm(client, sid, *ids(compose(client, sid, AZAR)))
    # 10 minutes to the shop: 18:05, five minutes after it closes
    [nudge] = plan(client, sid, AZAR_SHOP, depart_at="2026-10-21T17:55:00+03:30")["nudges"]
    assert (nudge["kind"], nudge["shop_id"], nudge["shop_name"]) == ("closing", AZAR_SHOP, "آذرنوش دیسیس")
    assert (nudge["closes_at"], nudge["leave_by"]) == ("2026-10-21T18:00:00+03:30", "2026-10-21T17:50:00+03:30")
    # the nearest other seller of the item open at the arrival: دیسیلا مانسا, same pasaj, open until 20:30
    swap = nudge["swap"]
    assert (swap["shop_id"], swap["shop_name"], swap["offer_id"], swap["price_toman"]) == (MANSA_SHOP, "دیسیلا مانسا", MANSA, 3_500_000)
    # in time: no warning
    assert plan(client, sid, AZAR_SHOP, depart_at="2026-10-21T17:45:00+03:30")["nudges"] == []
    # already closed when leaving is not closing on the way
    assert plan(client, sid, AZAR_SHOP, depart_at="2026-10-21T18:30:00+03:30")["nudges"] == []


def test_a_closing_shop_without_an_inquiry_warns_without_a_swap(client, fake_router):  # noqa: F811
    [nudge] = plan(client, new_session(client), AZAR_SHOP, depart_at="2026-10-21T17:55:00+03:30")["nudges"]
    assert (nudge["kind"], nudge["leave_by"], nudge["swap"]) == ("closing", "2026-10-21T17:50:00+03:30", None)


def test_a_confirmed_price_other_than_the_listed_one_nudges_with_the_budget_rechecked(client):
    sid = new_session(client)
    client.patch(f"/sessions/{sid}", json={"brief": {"budget": {"max_per_item_toman": 3_600_000}}})
    [mansa] = ids(confirm(client, sid, *ids(compose(client, sid, MANSA))))
    assert plan(client, sid, MANSA_SHOP)["nudges"] == []
    reply(client, mansa, latest_price_toman=3_500_000, available="yes")
    # the listed price, confirmed: nothing to say
    assert plan(client, sid, MANSA_SHOP)["nudges"] == []
    reply(client, mansa, latest_price_toman=3_700_000)
    [nudge] = plan(client, sid, MANSA_SHOP)["nudges"]
    assert (nudge["kind"], nudge["shop_id"], nudge["product_id"]) == ("price", MANSA_SHOP, "product_92ac53fa75e18e8e73f20b56")
    assert (nudge["listed_price_toman"], nudge["latest_price_toman"], nudge["price_delta_toman"]) == (3_500_000, 3_700_000, 200_000)
    assert (nudge["trust_level"], nudge["over_budget"]) == ("confirmed", True)


def test_a_website_price_other_than_the_listed_one_nudges(client, site):
    site({"https://mahdicable.ir/": PAGE}, {"price_toman": 580000})
    sid = new_session(client)
    assert plan(client, sid, MAHDI)["nudges"] == []
    fetch(client, sid)
    [nudge] = plan(client, sid, MAHDI)["nudges"]
    assert (nudge["kind"], nudge["shop_id"], nudge["product_id"], nudge["product_title"].startswith("کابل افشان")) == ("price", MAHDI, CABLE, True)
    assert (nudge["listed_price_toman"], nudge["latest_price_toman"], nudge["price_delta_toman"]) == (524000, 580000, 56000)
    assert (nudge["trust_level"], nudge["over_budget"]) == ("website_price", False)


def test_nudges_are_pushed_over_sse_as_the_clock_runs(client, clock, fake_router):  # noqa: F811
    clock(WEDNESDAY)
    sid = new_session(client)
    confirm(client, sid, *ids(compose(client, sid, AZAR)))
    params = {"shop_id": [AZAR_SHOP, MAHIS_SHOP], "session_id": sid, **ALADDIN}
    with client.stream("GET", "/visit-plan/stream", params=params) as r:
        updates = events(r)
        # leaving now arrives at 17:59:59, in time
        assert next(updates)["nudges"] == []
        # a second later leaving arrives after 18:00
        [nudge] = next(updates)["nudges"]
        assert (nudge["kind"], nudge["shop_id"], nudge["leave_by"]) == ("closing", AZAR_SHOP, "2026-10-21T17:50:00+03:30")
