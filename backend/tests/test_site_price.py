import httpx
import pytest

CABLE = "product_0a040d1b11770040095cec15"  # کابل افشان 4x2.5 خراسان افشارنژاد
MAHDI_OFFER = "offer_e423de52b01ad2a4173e6ad5"  # listed at 524,000
MAHDI = "shop_5e23e238af76b1365ad7f1b0"  # website https://mahdicable.ir/
PAGE = "<html><body><h2>کابل افشان 4x2.5 خراسان</h2><span>۵۸۰,۰۰۰ تومان</span><script>x()</script></body></html>"


def new_session(client):
    return client.post("/sessions").json()["session_id"]


def fetch(client, sid, shop_id=MAHDI, product_id=CABLE, status=200):
    r = client.post(f"/sessions/{sid}/site-prices", json={"shop_id": shop_id, "product_id": product_id})
    assert r.status_code == status, r.text
    return r.json()


def test_the_sites_search_page_gives_a_website_price_with_its_fetch_time(client, site, now):
    web = site({"https://mahdicable.ir/": PAGE}, {"price_toman": 580000})
    sid = new_session(client)
    price = fetch(client, sid)
    assert (price["shop_id"], price["shop_name"], price["product_id"], price["status"]) == (MAHDI, "سیم و کابل مهدی", CABLE, "found")
    assert (price["price_toman"], price["trust_level"]) == (580000, "website_price")
    assert price["fetched_at"] == now.isoformat()
    # the site's own search for the product title
    assert web.urls == [price["url"]]
    assert price["url"].startswith("https://mahdicable.ir/?s=")
    assert "4x2.5" in httpx.URL(price["url"]).params["s"]


def compared(client, sid):
    r = client.get(f"/products/{CABLE}/sellers/compare", params={"offer_id": MAHDI_OFFER, "session_id": sid})
    assert r.status_code == 200, r.text
    return r.json()["sellers"][0]


def test_seller_compare_shows_the_website_price_and_no_stock_claim(client, site, now):
    site({"https://mahdicable.ir/": PAGE}, {"price_toman": 580000})
    sid = new_session(client)
    assert compared(client, sid)["latest_price"]["status"] == "not_asked"
    fetch(client, sid)
    col = compared(client, sid)
    assert col["latest_price"] == {"status": "website", "price_toman": 580000, "trust_level": "website_price", "at": now.isoformat()}
    assert col["inquiry"] is None
    # the listing is still shown beside it
    assert col["price_toman"] == 524000
    # another session never sees it
    assert compared(client, new_session(client))["latest_price"]["status"] == "not_asked"


def test_the_tracker_lists_the_sessions_website_prices(client, site):
    site({"https://mahdicable.ir/": PAGE}, {"price_toman": 580000})
    sid = new_session(client)
    price = fetch(client, sid)
    tracked = client.get(f"/sessions/{sid}/inquiries").json()
    assert tracked == {"inquiries": [], "site_prices": [price]}


@pytest.mark.parametrize(
    "pages, parses",
    [
        ({"https://mahdicable.ir/": httpx.ReadTimeout("slow")}, []),
        ({"https://mahdicable.ir/": httpx.ConnectError("blocked")}, []),
        # the page loads but shows no price for the product
        ({"https://mahdicable.ir/": PAGE}, [{"price_toman": None}]),
    ],
    ids=["timeout", "error", "no_price"],
)
def test_a_failed_fetch_is_unavailable_and_leaves_the_seller_to_ask(client, site, pages, parses):
    site(pages, *parses)
    sid = new_session(client)
    price = fetch(client, sid)
    assert (price["status"], price["price_toman"]) == ("unavailable", None)
    assert compared(client, sid)["latest_price"]["status"] == "not_asked"
    assert client.get(f"/sessions/{sid}/inquiries").json()["site_prices"] == [price]
    # the inquiry it offers instead goes through as usual
    r = client.post(f"/sessions/{sid}/inquiries", json={"offer_ids": [MAHDI_OFFER]})
    assert r.status_code == 201, r.text


def test_without_a_model_the_price_is_unavailable(client):
    sid = new_session(client)
    assert fetch(client, sid)["status"] == "unavailable"


def test_a_newer_fetch_replaces_the_older_one(client, site):
    site({"https://mahdicable.ir/": PAGE}, {"price_toman": 580000}, {"price_toman": None})
    sid = new_session(client)
    fetch(client, sid)
    fetch(client, sid)
    assert [p["status"] for p in client.get(f"/sessions/{sid}/inquiries").json()["site_prices"]] == ["unavailable"]


def test_a_shop_without_a_website_or_an_unknown_id_is_refused(client):
    sid = new_session(client)
    fetch(client, sid, shop_id="shop_e31a5b73908ea869f50af78e", product_id="product_92ac53fa75e18e8e73f20b56", status=409)
    fetch(client, sid, shop_id="shop_nope", status=404)
    fetch(client, sid, product_id="product_nope", status=404)
    fetch(client, "no-such-session", status=404)
