import httpx

from pasazhgard.routing import Neshan, StraightLine, router_from_env

ALADDIN = (35.69483032610498, 51.41152782573596)
FARAZ = (35.68809056697517, 51.422494609357784)


def neshan(handler):
    requests = []

    def record(request):
        requests.append(request)
        return handler(request)

    return Neshan("test-key", httpx.Client(transport=httpx.MockTransport(record))), requests


def test_neshan_reads_distance_and_time_from_the_direction_api():
    body = {"routes": [{"legs": [{"distance": {"value": 1830}, "duration": {"value": 421}}]}]}
    router, requests = neshan(lambda r: httpx.Response(200, json=body))
    assert router.route(ALADDIN, FARAZ, "car").model_dump() == {"distance_m": 1830, "duration_min": 8, "source": "neshan"}
    (req,) = requests
    assert req.url.host == "api.neshan.org" and req.url.path == "/v4/direction"
    assert req.headers["Api-Key"] == "test-key"
    assert dict(req.url.params) == {"type": "car", "origin": f"{ALADDIN[0]},{ALADDIN[1]}", "destination": f"{FARAZ[0]},{FARAZ[1]}"}


def test_neshan_errors_fall_back_to_a_straight_line():
    fallback = StraightLine().route(ALADDIN, FARAZ, "car")
    assert fallback.source == "straight_line"
    for response in (httpx.Response(482), httpx.Response(200, json={"status": "ERROR"}), httpx.Response(200, text="<html>")):
        router, _ = neshan(lambda r, response=response: response)
        assert router.route(ALADDIN, FARAZ, "car") == fallback

    def down(request):
        raise httpx.ConnectTimeout("timeout")

    router, _ = neshan(down)
    assert router.route(ALADDIN, FARAZ, "car") == fallback


def test_neshan_routes_cars_only_so_walk_and_transit_are_straight_line():
    router, requests = neshan(lambda r: httpx.Response(500))
    for mode in ("walk", "transit"):
        assert router.route(ALADDIN, FARAZ, mode) == StraightLine().route(ALADDIN, FARAZ, mode)
    assert requests == []


def test_straight_line_time_follows_the_mode_speed():
    # 1.24 km: 4.5 km/h walking, 15 km/h transit, 20 km/h by car
    walk, transit, car = (StraightLine().route(ALADDIN, FARAZ, m) for m in ("walk", "transit", "car"))
    assert walk.distance_m == transit.distance_m == car.distance_m == 1242
    assert (walk.duration_min, transit.duration_min, car.duration_min) == (17, 5, 4)


def test_the_provider_needs_its_key(monkeypatch):
    monkeypatch.delenv("NESHAN_API_KEY", raising=False)
    assert isinstance(router_from_env(), StraightLine)
    monkeypatch.setenv("NESHAN_API_KEY", "k")
    assert isinstance(router_from_env(), Neshan)
