import socket

from pasazhgard.api import app, get_embedder
from pasazhgard.ingest import ingest

ANKER = "product_92ac53fa75e18e8e73f20b56"
ALADDIN = {"lat": 35.69483032610498, "lon": 51.41152782573596}


def new_session(client):
    r = client.post("/sessions")
    assert r.status_code == 201, r.text
    return r.json()["session_id"]


def patch(client, sid, body, status=200):
    r = client.patch(f"/sessions/{sid}", json=body)
    assert r.status_code == status, r.text
    return r.json()


def names(results):
    return [s["shop_name"] for s in results["sellers"]]


def test_new_session_holds_an_empty_brief(client):
    sid = new_session(client)
    session = client.get(f"/sessions/{sid}").json()
    assert session["session_id"] == sid
    assert session["step"] is None
    assert session["brief"] == {
        "need": None,
        "items": [],
        "budget": {"max_total_toman": None, "max_per_item_toman": None},
        "origin": None,
        "area": None,
        "visit_window": {"date": None, "earliest_arrival": None, "latest_departure": None},
        "travel_mode": None,
        "payment": {"kind": "any", "provider": None},
        "must_have": {"warranty": False, "test_in_presence": False, "fast_delivery": False},
        "priority": "cheapest",
        "plan": [],
        "inquiries": [],
    }
    # picker options for the area chip
    assert "فردوسی" in session["areas"] and "علاالدین" in session["pasajs"]


def test_unknown_session_is_404(client):
    assert client.get("/sessions/nope").status_code == 404
    assert client.patch("/sessions/nope", json={}).status_code == 404


def test_entering_the_seller_step_returns_its_results(client):
    sid = new_session(client)
    session = patch(client, sid, {"step": {"kind": "sellers", "product_id": ANKER}})
    assert session["results"]["count"] == 8
    assert names(session["results"])[0] == "نیکورا ویوان"
    # the step keeps the product title for the recent-sessions list
    assert session["step"]["title"] == session["results"]["title"]
    assert client.get(f"/sessions/{sid}").json()["step"]["product_id"] == ANKER


def test_area_patch_reruns_the_sellers_and_is_kept(client):
    sid = new_session(client)
    patch(client, sid, {"step": {"kind": "sellers", "product_id": ANKER}})
    session = patch(client, sid, {"brief": {"area": {"name": "فردوسی"}}})
    assert set(names(session["results"])) == {"نیین ماهیس", "دیسآرا مانوش"}
    assert client.get(f"/sessions/{sid}").json()["brief"]["area"] == {"radius_m": None, "name": "فردوسی", "pasaj": None}

    session = patch(client, sid, {"brief": {"area": {"pasaj": "علاالدین"}}})
    assert session["results"]["count"] == 4

    session = patch(client, sid, {"brief": {"origin": ALADDIN, "area": {"radius_m": 300}}})
    assert session["results"]["count"] == 7


def test_a_covered_area_or_pasaj_center_can_be_the_radius_origin(client):
    sid = new_session(client)
    centers = {(c["kind"], c["name"]): c for c in client.get(f"/sessions/{sid}").json()["centers"]}
    assert {("area", "فردوسی"), ("pasaj", "علاالدین")} <= set(centers)
    aladdin = centers["pasaj", "علاالدین"]
    # the mean of the pasaj's shops, a few meters from the shop at ALADDIN
    assert abs(aladdin["lat"] - ALADDIN["lat"]) < 0.002 and abs(aladdin["lon"] - ALADDIN["lon"]) < 0.002
    patch(client, sid, {"step": {"kind": "sellers", "product_id": ANKER}})
    origin = {"lat": aladdin["lat"], "lon": aladdin["lon"]}
    session = patch(client, sid, {"brief": {"origin": origin, "area": {"radius_m": 300}}})
    assert session["centers"] == list(centers.values())
    assert 0 < session["results"]["count"] < 8


def test_priority_patch_reranks(client):
    sid = new_session(client)
    patch(client, sid, {"step": {"kind": "sellers", "product_id": ANKER}, "brief": {"origin": ALADDIN}})
    session = patch(client, sid, {"brief": {"priority": "closest"}})
    assert names(session["results"])[0] == "دیسیلا مانسا"
    assert names(session["results"])[-1] == "دیسآرا مانوش"


def test_budget_patch_drops_sellers_above_it(client):
    sid = new_session(client)
    patch(client, sid, {"step": {"kind": "sellers", "product_id": ANKER}})
    session = patch(client, sid, {"brief": {"budget": {"max_total_toman": 1_700_000}}})
    # 1,690,000 is the cheapest listed price; unpriced sellers stay, they may still fit
    assert [(s["shop_name"], s["price_toman"]) for s in session["results"]["sellers"]] == [
        ("نیکورا ویوان", 1690000), ("مهردیس سروورا", None), ("دیسآرا مانوش", None),
    ]


def test_budget_total_counts_the_quantity_and_per_item_the_unit_price(client):
    sid = new_session(client)
    items = [{"product_id": ANKER, "quantity": 2}]
    patch(client, sid, {"step": {"kind": "sellers", "product_id": ANKER}, "brief": {"items": items}})
    # two at 1,690,000 is over a 1,700,000 total
    session = patch(client, sid, {"brief": {"budget": {"max_total_toman": 1_700_000}}})
    assert [s["price_toman"] for s in session["results"]["sellers"]] == [None, None]
    session = patch(client, sid, {"brief": {"budget": {"max_per_item_toman": 1_700_000}}})
    assert [s["price_toman"] for s in session["results"]["sellers"]] == [1690000, None, None]
    session = patch(client, sid, {"brief": {"budget": {"max_total_toman": 3_380_000}}})
    assert [s["price_toman"] for s in session["results"]["sellers"]] == [1690000, None, None]


def test_other_chips_are_kept_in_the_brief(client):
    sid = new_session(client)
    body = {
        "visit_window": {"date": "2026-10-21", "earliest_arrival": "17:00"},
        "travel_mode": "transit",
        "payment": {"kind": "installment", "provider": "اسنپ‌پی"},
    }
    session = patch(client, sid, {"brief": body})
    brief = client.get(f"/sessions/{sid}").json()["brief"]
    assert brief["visit_window"] == {"date": "2026-10-21", "earliest_arrival": "17:00:00", "latest_departure": None}
    assert (brief["travel_mode"], brief["payment"]["provider"]) == ("transit", "اسنپ‌پی")
    # a patch sets only the fields it names
    assert brief["priority"] == "cheapest"
    # no step yet, nothing to re-run
    assert session["results"] is None


def test_bad_patch_is_422_and_leaves_the_brief(client):
    sid = new_session(client)
    patch(client, sid, {"brief": {"area": {"radius_m": 300}}}, status=422)
    patch(client, sid, {"brief": {"priority": "nearest"}}, status=422)
    patch(client, sid, {"step": {"kind": "sellers", "product_id": "product_missing"}}, status=404)
    # the planner and the Seller Liaison own plan and inquiries; unknown fields are refused, not dropped
    patch(client, sid, {"brief": {"plan": [{"shop_id": "x"}]}}, status=422)
    patch(client, sid, {"brief": {"inquiries": [{"q": "x"}]}}, status=422)
    patch(client, sid, {"brief": {"colour": "red"}}, status=422)
    session = client.get(f"/sessions/{sid}").json()
    assert (session["brief"]["area"], session["brief"]["priority"], session["step"]) == (None, "cheapest", None)
    assert (session["brief"]["plan"], session["brief"]["inquiries"]) == ([], [])


def test_search_step_searches_the_need(client):
    sid = new_session(client)
    session = patch(client, sid, {"brief": {"need": "انکر R50i"}, "step": {"kind": "search"}})
    assert ANKER in [p["product_id"] for p in session["results"]["items"]]


def test_session_search_finds_products_by_meaning(client, embedder):
    app.dependency_overrides[get_embedder] = lambda: embedder
    try:
        session = patch(client, new_session(client), {"brief": {"need": "هندزفری ورزشی"}, "step": {"kind": "search"}})
    finally:
        app.dependency_overrides[get_embedder] = lambda: None
    # the R50i title says neither word, so only the meaning match finds it
    card = next(c for c in session["results"]["items"] if c["product_id"] == ANKER)
    assert card["meaning_match"] is True
    assert not any(p["matched"] for p in card["score_parts"])


def test_brief_edits_make_no_llm_call(client, embedder, monkeypatch):
    # an LLM request would open a socket from Python (the DB driver uses libpq); embeddings go through the fake
    calls = []

    def blocked(self, address):
        calls.append(address)
        raise OSError("network is off in this test")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    chips = (
        {"area": {"name": "فردوسی"}},
        {"budget": {"max_total_toman": 2_000_000}},
        {"visit_window": {"earliest_arrival": "17:00"}},
        {"travel_mode": "walk"},
        {"payment": {"kind": "cash"}},
        {"priority": "most_reliable"},
    )
    app.dependency_overrides[get_embedder] = lambda: embedder
    try:
        sid = new_session(client)
        # entering the need may embed it once
        patch(client, sid, {"brief": {"need": "انکر R50i هدفون"}, "step": {"kind": "search"}})
        embedded = len(embedder.calls)
        # each chip edit re-runs the search for the same need
        for brief in chips:
            patch(client, sid, {"brief": brief})
        patch(client, sid, {"step": {"kind": "sellers", "product_id": ANKER}})
        for brief in chips:
            patch(client, sid, {"brief": brief})
    finally:
        app.dependency_overrides[get_embedder] = lambda: None
    assert calls == []
    assert len(embedder.calls) == embedded


def test_sessions_survive_a_reingest(client, fixture_dir, database_url, embedder):
    sid = new_session(client)
    patch(client, sid, {"brief": {"priority": "closest"}})
    ingest(fixture_dir, database_url, embedder)
    assert client.get(f"/sessions/{sid}").json()["brief"]["priority"] == "closest"
