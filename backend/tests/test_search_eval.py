import importlib.util
from pathlib import Path

R50I = "product_92ac53fa75e18e8e73f20b56"


def load_eval(name="search"):
    spec = importlib.util.spec_from_file_location(f"{name}_eval", Path(__file__).parents[1] / "eval" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_eval_runs_each_query_through_the_search_api(client):
    cases = [
        {"query": "انکر R50i", "expected": [R50I]},
        {"query": "کابل افشان", "expected": [R50I]},
    ]
    assert load_eval().hit_count(client, cases) == 1


def test_agent_eval_counts_queries_whose_top_5_cards_hold_an_expected_product(client):
    # no model: the agent's degraded turn searches the user's words
    cases = [
        {"query": "انکر R50i", "expected": [R50I]},
        {"query": "کابل افشان", "expected": [R50I]},
    ]

    report = load_eval("agent").run(client, cases)

    assert (report["hits"], report["queries"]) == (1, 2)
    assert report["ungrounded"] == []


NEED = "هندزفری بلوتوثی ورزشی"
HEADPHONES = "هدفون، هدست و هندزفری"


def test_agent_eval_checks_the_shortlist_of_a_vague_need_in_its_area(agent, client, embedder):
    from pasazhgard.api import app, get_embedder

    app.dependency_overrides[get_embedder] = lambda: embedder
    agent.script(
        *[agent.brief(), agent.call("suggest_models", need=NEED), "این مدل‌ها نزدیک شما هستند."] * 2,
    )
    cases = [
        {"need": NEED, "pasaj": "علاالدین", "category": HEADPHONES},
        # no headphone seller in this pasaj
        {"need": NEED, "pasaj": "بوشهری", "category": HEADPHONES},
    ]

    try:
        report = load_eval("agent").run(client, cases)
    finally:
        app.dependency_overrides[get_embedder] = lambda: None

    assert (report["shortlists"], report["needs"]) == (1, 2)


def test_agent_eval_answers_a_question_and_reads_the_next_turn(agent, client):
    agent.script(
        agent.brief(),
        agent.call("ask_user", field="area", question="کجا؟"),
        agent.brief(),
        agent.call("search_products", query="هدفون انکر"),
        "این‌ها را پیدا کردم.",
    )

    report = load_eval("agent").run(client, [{"query": "هدفون", "expected": [R50I]}])

    assert report["hits"] == 1


def test_agent_eval_lists_ungrounded_claims_across_transcripts(agent, client):
    agent.script(agent.brief(), agent.call("find_sellers", product_id=R50I), "ارزان‌ترین ۱٬۵۰۰٬۰۰۰ تومان است و موجود است.")

    report = load_eval("agent").run(client, [{"query": "ارزان‌ترین هدفون انکر R50i", "expected": [R50I]}])

    assert report["ungrounded"] == [("ارزان‌ترین هدفون انکر R50i", "price 1500000"), ("ارزان‌ترین هدفون انکر R50i", "in stock")]


def test_a_failed_run_is_a_miss_and_the_eval_goes_on(agent, client):
    # the model has no reply after the brief patch: the run errors
    agent.script(agent.brief())

    report = load_eval("agent").run(client, [{"query": "هدفون", "expected": [R50I]}, {"query": "هدفون", "expected": [R50I]}])

    assert (report["hits"], report["queries"]) == (0, 2)
