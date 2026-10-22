import importlib.util
from pathlib import Path

import pytest

from pasazhgard.api import app, get_embedder

R50I = "product_92ac53fa75e18e8e73f20b56"
R50I_NC = "product_13f930f4c1400c7ab7bfa61f"
R60I_NC = "product_e372fa27c7d7c5c171c14858"
QCY = "product_a0b9dc5ecc796b0f79a33cf3"
AIRPODS = "product_87275da84ee308b9814d5085"


NEED = "هندزفری بلوتوثی ورزشی"


@pytest.fixture
def client(client, embedder):
    # discovery runs with embeddings: a need rarely shares words with model titles
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield client
    app.dependency_overrides[get_embedder] = lambda: None


def suggest(client, need, **params):
    r = client.get("/products/suggest", params={"need": need, **params})
    assert r.status_code == 200, r.text
    return r.json()


def ids(shortlist):
    return [m["product_id"] for m in shortlist["models"]]


def test_shortlist_prefers_models_with_several_nearby_sellers(client):
    # in Aladdin: R50i and R50i NC have 4 sellers, R60i NC 3, QCY 2, Redmi and AirPods 1
    shortlist = suggest(client, NEED, pasaj="علاالدین")

    assert set(ids(shortlist)) == {R50I, R50I_NC, R60I_NC}
    assert {m["seller_count"] for m in shortlist["models"]} == {4, 3}


def test_shortlist_holds_only_models_with_a_seller_in_the_area(client):
    # Charsoo: one seller each for R50i, R50i NC, QCY and Redmi; none for R60i NC or AirPods
    shortlist = suggest(client, NEED, pasaj="چارسو")

    assert len(shortlist["models"]) == 3
    assert not {R60I_NC, AIRPODS} & set(ids(shortlist))
    assert all(m["seller_count"] == 1 for m in shortlist["models"])


def test_budget_drops_sellers_above_it_and_more_sellers_rank_first(client):
    # up to 3,000,000 in Aladdin: R50i 2 sellers (1,690,000 and 3,000,000), QCY 1 (2,190,000), AirPods 1 (830,000)
    shortlist = suggest(client, NEED, pasaj="علاالدین", max_per_item_toman=3_000_000)

    assert set(ids(shortlist)) == {R50I, QCY, AIRPODS}
    r50i = next(m for m in shortlist["models"] if m["product_id"] == R50I)
    assert (r50i["seller_count"], r50i["price"]["min_toman"], r50i["price"]["max_toman"]) == (2, 1_690_000, 3_000_000)


def test_each_model_has_key_specs_nearby_prices_and_trade_offs_citing_specs(client):
    shortlist = suggest(client, NEED, pasaj="علاالدین")

    r50i = next(m for m in shortlist["models"] if m["product_id"] == R50I)
    assert r50i["title"] == "هدفون بلوتوثی انکر Soundcore R50i مدل A3949"
    assert r50i["key_specs"]
    assert (r50i["price"]["min_toman"], r50i["price"]["max_toman"]) == (1_690_000, 3_500_000)
    # the cheapest of the three, on an older Bluetooth than R60i NC
    assert "ارزان‌ترین گزینه" in r50i["tradeoffs"]
    assert "نسخه بلوتوث: 5.3" in r50i["tradeoffs"]
    r60i = next(m for m in shortlist["models"] if m["product_id"] == R60I_NC)
    assert "نسخه بلوتوث: ورژن5.4" in r60i["tradeoffs"]
    assert "گران‌ترین گزینه" in r60i["tradeoffs"]


def test_no_model_nearby_is_an_empty_shortlist(client):
    assert suggest(client, NEED, pasaj="بوشهری")["models"] == []


def test_the_agent_shows_the_shortlist_for_the_brief_area(agent):
    agent.script(
        agent.brief(need="هندزفری بلوتوثی برای باشگاه", use="باشگاه", area={"pasaj": "علاالدین"}),
        agent.call("suggest_models", need=NEED),
        "این سه مدل نزدیک شما فروشنده دارند.",
    )

    turn = agent.turn("یه هندزفری بلوتوثی برای باشگاه توی علاالدین")

    shortlist = turn.blocks[0]
    assert shortlist["block"] == "model_shortlist"
    assert set(ids(shortlist)) == {R50I, R50I_NC, R60I_NC}


def test_no_model_nearby_tells_the_agent_to_widen_the_area(agent):
    agent.script(agent.brief(area={"pasaj": "بوشهری"}), agent.call("suggest_models", need=NEED), "در این پاساژ مدلی پیدا نشد.")

    turn = agent.turn("هندزفری ورزشی توی بوشهری")

    assert "block" not in turn.blocks[0]


def test_discovery_asks_use_with_the_models_options(agent):
    agent.script(
        agent.brief(need="هندزفری بلوتوثی"),
        agent.call("ask_user", field="use", question="برای چه کاری؟", options=["ورزش", "تماس", "موسیقی"]),
    )

    turn = agent.turn("کمکم کن انتخاب کنم، یه هندزفری بلوتوثی")

    assert turn.blocks == [{"block": "chips", "field": "use", "question": "برای چه کاری؟", "options": ["ورزش", "تماس", "موسیقی"]}]


def test_a_need_only_request_runs_discovery_and_skips_what_the_brief_answers(agent):
    agent.script(
        agent.brief(need="هندزفری بلوتوثی برای باشگاه", use="باشگاه", area={"pasaj": "علاالدین"}),
        # the need already says the use, so the question is refused and the model moves on
        agent.call("ask_user", field="use", question="برای چه کاری؟", options=["ورزش", "تماس"]),
        agent.call("ask_user", field="budget", question="تا چه قیمتی؟"),
        agent.brief(budget={"max_per_item_toman": 3_000_000}),
        agent.call("ask_user", field="budget", question="بودجه؟"),
        agent.call("suggest_models", need=NEED),
        "این‌ها در بودجهٔ شما هستند.",
    )

    first = agent.turn("یه هندزفری بلوتوثی برای باشگاه توی علاالدین می‌خوام، نمی‌دونم کدوم مدل")
    second = agent.turn("تا ۳ میلیون")

    assert first.blocks[0] == {"error": "the brief already has use"}
    assert first.blocks[1]["field"] == "budget"
    assert second.blocks[0] == {"error": "the brief already has budget"}
    assert set(ids(second.blocks[1])) == {R50I, QCY, AIRPODS}


def test_a_question_is_asked_once_per_thread(agent):
    agent.script(
        agent.brief(need="هندزفری"),
        agent.call("ask_user", field="features", question="چه ویژگی‌ای لازم است؟", options=["ضد آب", "حذف نویز"]),
        agent.brief(),
        agent.call("ask_user", field="features", question="ویژگی خاصی؟", options=["ضد آب"]),
        "باشه، بدون ویژگی خاص.",
    )

    agent.turn("هندزفری")
    turn = agent.turn("فرقی نمی‌کند")

    assert turn.blocks[0] == {"error": "already asked about features"}


def test_discovery_eval_counts_shortlists_holding_the_expected_category(client):
    spec = importlib.util.spec_from_file_location("discovery_eval", Path(__file__).parents[1] / "eval" / "discovery.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cases = [
        {"need": NEED, "pasaj": "علاالدین", "kind": "vague need", "category": "هدفون، هدست و هندزفری"},
        {"need": NEED, "pasaj": "بوشهری", "kind": "vague need", "category": "هدفون، هدست و هندزفری"},
    ]

    assert module.hit_count(client, cases) == 1
