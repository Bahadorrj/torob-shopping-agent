from datetime import datetime

import pytest

from pasazhgard.api import app, get_now

INSTALLMENTS = "shop_03832fb8b03821313a1c6771"


def shop(client, shop_id):
    r = client.get(f"/shops/{shop_id}")
    assert r.status_code == 200, r.text
    return r.json()


def test_shop_page_fields(client):
    s = shop(client, INSTALLMENTS)
    assert s["shop_id"] == INSTALLMENTS
    assert s["name"] == "ویسا رویلا"
    assert s["address"] == "خیابان جمهوری اسلامی، نبش خیابان شیخ هادی، مجتمع علاالدین ۲، طبقه ۳، واحد ۳۲۷"
    assert (s["pasaj"], s["floor"], s["unit"], s["landmark"]) == ("علاالدین 2", "۳", "۳۲۷", "نبش خیابان شیخ هادی")
    assert s["payment_options"] == [
        {"provider": "تارا", "channel": "in_person"},
        {"provider": "اسنپ‌پی", "channel": "in_person"},
        {"provider": "دیجی پی", "channel": "in_person"},
        {"provider": "ترب‌پی", "channel": "in_person"},
    ]
    assert s["fast_delivery"] == "yes"
    assert (s["website_url"], s["instagram_url"]) == (None, None)


def test_hours_today_and_week(client):
    hours = shop(client, INSTALLMENTS)["hours"]
    # the test clock is Wednesday 2026-10-21 12:00 in Tehran
    assert hours["timezone"] == "Asia/Tehran"
    assert hours["today"] == "wed"
    assert [d["day"] for d in hours["week"]] == ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]
    assert hours["week"][4] == {"day": "wed", "status": "declared", "shifts": [{"start": "09:30", "end": "18:30"}]}
    assert hours["week"][5]["shifts"] == [{"start": "09:30", "end": "16:00"}]
    assert hours["week"][6] == {"day": "fri", "status": "closed", "shifts": []}


def test_today_follows_the_tehran_clock(client):
    # 22:00 UTC on Thursday is already Friday in Tehran
    saved = app.dependency_overrides[get_now]
    app.dependency_overrides[get_now] = lambda: datetime.fromisoformat("2026-10-22T22:00:00+00:00")
    try:
        assert shop(client, INSTALLMENTS)["hours"]["today"] == "fri"
    finally:
        app.dependency_overrides[get_now] = saved


def test_multi_shift_day(client):
    sun = shop(client, "shop_666ee4ff99fe5d13d1c99c53")["hours"]["week"][1]
    assert sun["shifts"] == [{"start": "10:30", "end": "19:00"}, {"start": "20:30", "end": "23:30"}]


def test_shop_without_hours_is_unknown(client):
    s = shop(client, "shop_cb9575d65ca60e60563e911f")
    assert {d["status"] for d in s["hours"]["week"]} == {"unknown"}
    # spelled علائدین in the address
    assert s["pasaj"] == "علاالدین"


def test_unsupported_hours_stay_distinct(client):
    week = shop(client, "shop_9900a46f54a879ce260839bb")["hours"]["week"]
    assert [d["status"] for d in week] == ["unsupported", "unsupported", "unsupported", "unsupported", "unsupported", "declared", "closed"]


@pytest.mark.parametrize(
    "shop_id, payment, delivery",
    [
        ("shop_9f2dc82937bde15452981294", [{"provider": "اسنپ‌پی", "channel": "unknown"}], "unknown"),
        ("shop_7a110d0099f583d28496d44d", [], "no"),
    ],
)
def test_payment_channel_and_delivery(client, shop_id, payment, delivery):
    s = shop(client, shop_id)
    assert (s["payment_options"], s["fast_delivery"]) == (payment, delivery)


def test_website_and_instagram(client):
    assert shop(client, "shop_5e23e238af76b1365ad7f1b0")["website_url"] == "https://mahdicable.ir/"
    assert shop(client, "shop_0190ae9d8cf49a7884b0db6e")["instagram_url"] == "https://www.instagram.com/digiphonee/"


def test_landmark_naming_another_pasaj(client):
    s = shop(client, "shop_4490fa1498e6d5cc39eded8f")
    assert (s["pasaj"], s["landmark"]) == ("حافظ", "روبروی علالدین")


def test_unknown_shop_is_404(client):
    assert client.get("/shops/shop_missing").status_code == 404
