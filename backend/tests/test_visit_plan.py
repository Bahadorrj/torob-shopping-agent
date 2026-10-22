import pytest

from pasazhgard.api import app, get_router
from pasazhgard.routing import Route

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
