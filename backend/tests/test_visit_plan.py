import pytest

from pasazhgard.api import app, get_router
from pasazhgard.routing import Route
from pasazhgard.visit import floor_level

ALADDIN = {"lat": 35.69483032610498, "lon": 51.41152782573596}
DISIS = "shop_81c53acd00d779578fff4a40"  # آذرنوش دیسیس: علاالدین, floor ۲, unit ۲۱۶, landmark


class FakeRouter:
    """Every leg is 1 km and 10 minutes by the provider."""

    def route(self, a, b, mode):
        return Route(distance_m=1000, duration_min=10, source="neshan")


@pytest.fixture
def fake_router():
    saved = app.dependency_overrides[get_router]
    app.dependency_overrides[get_router] = lambda: FakeRouter()
    yield
    app.dependency_overrides[get_router] = saved


def test_directions_route_links_and_last_leg(client, fake_router):
    r = client.get(f"/shops/{DISIS}/directions", params={**ALADDIN, "mode": "car"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["shop_name"] == "آذرنوش دیسیس"
    assert d["route"] == {"distance_m": 1000, "duration_min": 10, "source": "neshan"}
    assert d["last_leg"] == {"pasaj": "علاالدین", "landmark": "رو‌به‌روی پاساژ چهارسو", "floor": "۲", "unit": "۲۱۶"}
    dest = f"{d['lat']},{d['lon']}"
    origin = f"{ALADDIN['lat']},{ALADDIN['lon']}"
    assert d["links"]["neshan"] == f"https://nshn.ir/?origin={origin}&destination={dest}&vehicle=d"
    assert d["links"]["balad"] == f"https://balad.ir/location?latitude={d['lat']}&longitude={d['lon']}&zoom=18"
    assert d["links"]["google"] == f"https://www.google.com/maps/dir/?api=1&origin={origin}&destination={dest}&travelmode=driving"


def plan(client, *shops, **params):
    r = client.get("/visit-plan", params={"shop_id": list(shops), **params})
    assert r.status_code == 200, r.text
    return r.json()


VIVAN = "shop_c060bc5ea37b78e00ece4bdb"  # علاالدین, زیر همکف
MANSA = "shop_e31a5b73908ea869f50af78e"  # علاالدین, همکف; the origin ALADDIN is this shop
PAKYAR = "shop_4934392f0e4fefe1526308c6"  # علاالدین, floor 5
MAHIS = "shop_9f2dc82937bde15452981294"  # چارسو, about 90 m from Aladdin
NIKIS = "shop_2f1316e03a71e0b95ae1e974"  # فراز, about 1.2 km south-east
RAMSAROOSH = "shop_4f7265550833ec467126731a"  # گل, about 800 m north of فراز
NOVOSH = "shop_cc86297cb54087e8774e77ff"  # بوشهری: Thursday 09:30-14:00, Friday closed
FARISA = "shop_d534343f7fccc852eda22228"  # میخک: hours not recorded


def test_stops_in_one_pasaj_are_grouped_and_ordered_by_floor(client, fake_router):
    stops = plan(client, NIKIS, PAKYAR, MANSA, MAHIS, DISIS, VIVAN, **ALADDIN)["stops"]
    # basement, ground, 2, 5 in Aladdin; then the next pasaj over, then the far one
    assert [s["shop_id"] for s in stops] == [VIVAN, MANSA, DISIS, PAKYAR, MAHIS, NIKIS]
    assert [s["last_leg"]["floor"] for s in stops[:4]] == ["زیر همکف", "همکف", "۲", "5"]
    # between pasajs the provider routes; inside one pasaj it is a short walk
    assert [s["route"]["source"] for s in stops] == ["neshan", "straight_line", "straight_line", "straight_line", "neshan", "neshan"]
    assert all(s["route"]["distance_m"] < 100 for s in stops[1:4])


def test_stops_are_ordered_for_the_shortest_trip(client):
    origin = {"lat": 35.68809056697517, "lon": 51.422494609357784}  # at فراز
    stops = plan(client, MANSA, MAHIS, RAMSAROOSH, **origin)["stops"]
    assert [s["shop_id"] for s in stops] == [RAMSAROOSH, MAHIS, MANSA]


def test_each_leg_starts_where_the_last_one_ended(client, fake_router):
    first, second = plan(client, NIKIS, MAHIS, **ALADDIN, mode="car")["stops"]
    origin = f"{ALADDIN['lat']},{ALADDIN['lon']}"
    assert f"origin={origin}&destination={first['lat']},{first['lon']}" in first["links"]["google"]
    assert f"origin={first['lat']},{first['lon']}&destination={second['lat']},{second['lon']}" in second["links"]["google"]
    assert second["links"]["google"].endswith("travelmode=driving")


def test_eta_and_open_at_eta(client, fake_router):
    # Thursday: 10 minutes to the first shop, 15 minutes there, 10 to the next
    result = plan(client, FARISA, NOVOSH, lat=35.68994907778962, lon=51.422686278820045, depart_at="2026-10-22T13:35:00+03:30")
    first, second = result["stops"]
    assert (first["shop_id"], first["eta"], first["open_at_eta"]) == (NOVOSH, "2026-10-22T13:45:00+03:30", True)
    # unknown hours stay unknown, never open or closed
    assert (second["shop_id"], second["eta"], second["open_at_eta"]) == (FARISA, "2026-10-22T14:10:00+03:30", None)
    # Thursday early close
    late = plan(client, NOVOSH, lat=35.69, lon=51.42, depart_at="2026-10-22T13:55:00+03:30")["stops"][0]
    assert (late["eta"], late["open_at_eta"]) == ("2026-10-22T14:05:00+03:30", False)
    # Friday closure
    friday = plan(client, NOVOSH, lat=35.69, lon=51.42, depart_at="2026-10-23T11:00:00+03:30")["stops"][0]
    assert friday["open_at_eta"] is False


def test_departure_defaults_to_now(client, fake_router):
    result = plan(client, NOVOSH, **ALADDIN)
    # the test clock is Wednesday 12:00
    assert result["depart_at"] == "2026-10-21T12:00:00+03:30"
    assert result["stops"][0]["eta"] == "2026-10-21T12:10:00+03:30"


def test_plan_input_is_checked(client):
    assert client.get("/visit-plan", params={"shop_id": [VIVAN, "shop_missing"], **ALADDIN}).status_code == 404
    seven = [VIVAN, MANSA, PAKYAR, MAHIS, NIKIS, RAMSAROOSH, NOVOSH]
    for params in (
        {"shop_id": seven, **ALADDIN},
        {"shop_id": [VIVAN, VIVAN], **ALADDIN},
        {"shop_id": [VIVAN]},
        {"shop_id": [VIVAN], **ALADDIN, "depart_at": "2026-10-22T13:35:00"},
        {**ALADDIN},
    ):
        assert client.get("/visit-plan", params=params).status_code == 422, params


@pytest.mark.parametrize(
    "floor, level",
    [
        ("همکف", 0), ("هم کف", 0), ("همكف", 0), ("بالای همکف", None), ("ـ۱", -1),
        ("اول", 1), ("۱", 1), ("2", 2), ("دوم جنوبی", 2), ("سوم", 3), ("چهارم", 4), ("پنجم", 5), ("۱۱ شمالی", 11), ("3A", 3),
        ("زیر همکف", -1), ("زیرهمکف", -1), ("زیرزمین", -1), ("منفی یک", -1), ("منفی ۱", -1), ("-۱", -1), ("۱-", -1), ("منفی ۲", -2),
        ("آخر", None), (None, None),
    ],
)
def test_floor_level(floor, level):
    assert floor_level(floor) == level
