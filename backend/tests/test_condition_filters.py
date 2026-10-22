from datetime import datetime
from zoneinfo import ZoneInfo

from pasazhgard.api import app, get_now

ANKER = "product_92ac53fa75e18e8e73f20b56"


def sellers(client, product_id=ANKER, **brief):
    sid = client.post("/sessions").json()["session_id"]
    r = client.patch(f"/sessions/{sid}", json={"brief": brief, "step": {"kind": "sellers", "product_id": product_id}})
    assert r.status_code == 200, r.text
    return r.json()["results"]


def names(rows):
    return [s["shop_name"] for s in rows]


def test_clock_gives_tehran_time():
    now = get_now()
    assert now.tzinfo == ZoneInfo("Asia/Tehran")
    assert abs((datetime.now(ZoneInfo("UTC")) - now).total_seconds()) < 5


# روان فرین: sun 10:30-19:00 and 20:30-23:30, thu 10:30-15:00; راموان مهریلا: 10:00-19:00, thu 10:00-16:00;
# دیسان سرویار: 09:30-18:00, thu 09:30-14:00; all closed on Friday
CABLE = "product_1b6783682cab7f15c10b887a"


def at(date, time):
    return {"visit_window": {"date": date, "earliest_arrival": time}}


def test_open_at_arrival_handles_shifts_breaks_thursday_and_friday(client):
    assert names(sellers(client, CABLE, **at("2026-10-25", "12:00"))["sellers"]) == ["دیسان سرویار", "راموان مهریلا", "روان فرین"]
    # the second Sunday shift
    assert names(sellers(client, CABLE, **at("2026-10-25", "21:00"))["sellers"]) == ["روان فرین"]
    # between the two Sunday shifts, and after the others close
    assert sellers(client, CABLE, **at("2026-10-25", "19:30"))["sellers"] == []
    # Thursday early close
    assert names(sellers(client, CABLE, **at("2026-10-22", "15:30"))["sellers"]) == ["راموان مهریلا"]
    assert sellers(client, CABLE, **at("2026-10-23", "12:00"))["sellers"] == []


def test_arrival_without_a_date_is_today(client):
    # the clock reads Wednesday 2026-10-21 12:00
    assert len(sellers(client, CABLE, visit_window={"earliest_arrival": "18:30"})["sellers"]) == 2


def test_unknown_hours_shops_are_asked_not_dropped(client):
    result = sellers(client, **at("2026-10-21", "12:00"))
    assert names(result["ask_them"]) == ["دیسورا پاکیار", "نیکسا مانوش", "مهردیس سروورا"]
    assert {tuple(s["unknown"]) for s in result["ask_them"]} == {("hours",)}
    assert result["count"] == 5 and all(s["unknown"] == [] for s in result["sellers"])


HEADSET = "product_9c1c0b63163bb432a75dc740"  # روین نیکین declares اسنپ‌پی in person
MOUSE = "product_b96e414eabcbeed813491ff0"  # ویسا رویلا declares تارا، اسنپ‌پی، دیجی پی، ترب‌پی in person


def test_installment_by_provider(client):
    result = sellers(client, HEADSET, payment={"kind": "installment", "provider": "اسنپ‌پی"})
    assert names(result["sellers"]) == ["روین نیکین"]
    assert result["sellers"][0]["payment_options"] == [{"provider": "اسنپ‌پی", "channel": "in_person"}]
    # no shop says it does not take installments, so the rest are asked
    assert len(result["ask_them"]) == 4 and {tuple(s["unknown"]) for s in result["ask_them"]} == {("payment",)}
    # the provider matches whatever its spacing
    assert names(sellers(client, MOUSE, payment={"kind": "installment", "provider": "دیجی‌پی"})["sellers"]) == ["ویسا رویلا"]
    assert sellers(client, HEADSET, payment={"kind": "installment", "provider": "تارا"})["sellers"] == []


def test_any_installment_provider(client):
    # both declare installments, with no channel
    assert names(sellers(client, payment={"kind": "installment"})["sellers"]) == ["نیین ماهیس", "آذرنوش دیسیس"]


def test_torob_pay_in_person(client):
    assert names(sellers(client, MOUSE, payment={"kind": "torob_pay"})["sellers"]) == ["ویسا رویلا"]
    # آذرنوش دیسیس takes ترب‌پی but did not say in person
    result = sellers(client, payment={"kind": "torob_pay"})
    assert result["sellers"] == [] and "آذرنوش دیسیس" in names(result["ask_them"])


def test_cash_filters_nothing(client):
    assert sellers(client, payment={"kind": "cash"})["count"] == 8


def test_warranty(client):
    result = sellers(client, must_have={"warranty": True})
    assert names(result["sellers"]) == ["نیکسا مانوش", "دیسیلا مانسا"]
    # a warranty without a term ("تایید اصالت") is not recorded as one
    assert "دیسورا پاکیار" in names(result["ask_them"]) and len(result["ask_them"]) == 6
    # "ندارد" says no warranty
    result = sellers(client, "product_925e0c74f43d3d736ca74bc4", must_have={"warranty": True})
    assert "نیین پاکدیس" not in names(result["sellers"] + result["ask_them"])


def test_test_in_presence(client):
    result = sellers(client, MOUSE, must_have={"test_in_presence": True})
    assert names(result["sellers"]) == ["روین آودیس"]
    assert {tuple(s["unknown"]) for s in result["ask_them"]} == {("test_in_presence",)}


def test_fast_delivery(client):
    result = sellers(client, "product_17ecdf2bf4e2e78dc9652a19", must_have={"fast_delivery": True})
    # ماهورا پاکیلا says it does not deliver fast
    assert "ماهورا پاکیلا" not in names(result["sellers"] + result["ask_them"])
    assert {tuple(s["unknown"]) for s in result["ask_them"]} == {("fast_delivery",)}
    result = sellers(client, HEADSET, must_have={"fast_delivery": True})
    assert names(result["sellers"]) == ["روین نیکین", "نیکآرا نوینا", "رامیس نیآرا"]


def test_every_unknown_condition_is_listed(client):
    result = sellers(client, **at("2026-10-21", "12:00"), must_have={"warranty": True}, payment={"kind": "installment"})
    assert result["sellers"] == []
    rows = {s["shop_name"]: s["unknown"] for s in result["ask_them"]}
    assert rows["مهردیس سروورا"] == ["hours", "payment", "warranty"]


def reasons(result, name):
    return next(s["reasons"] for s in result["sellers"] + result["ask_them"] if s["shop_name"] == name)


def test_open_now_chip_reads_the_clock(client):
    # Wednesday 12:00
    result = sellers(client)
    assert {"kind": "open_now", "months": None, "provider": None} in reasons(result, "دیسیلا مانسا")
    assert "open_now" not in [r["kind"] for r in reasons(result, "نیکسا مانوش")]  # hours not recorded
    saved = app.dependency_overrides[get_now]
    app.dependency_overrides[get_now] = lambda: datetime(2026, 10, 23, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    try:
        result = sellers(client)
    finally:
        app.dependency_overrides[get_now] = saved
    # closed on Friday
    assert "open_now" not in [r["kind"] for r in reasons(result, "دیسیلا مانسا")]


def test_installment_chip_names_the_declared_provider(client):
    chip = {"kind": "installments", "months": None, "provider": "دیجی پی"}
    assert chip in reasons(sellers(client, MOUSE, payment={"kind": "installment", "provider": "دیجی‌پی"}), "ویسا رویلا")
    result = sellers(client, MOUSE)
    assert {"kind": "installments", "months": None, "provider": "تارا"} in reasons(result, "ویسا رویلا")
    assert "installments" not in [r["kind"] for r in reasons(result, "روین آودیس")]
