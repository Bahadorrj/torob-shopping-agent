import importlib.util
from pathlib import Path

R50I = "product_92ac53fa75e18e8e73f20b56"


def load_eval():
    spec = importlib.util.spec_from_file_location("search_eval", Path(__file__).parents[1] / "eval" / "search.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_eval_runs_each_query_through_the_search_api(client):
    cases = [
        {"query": "انکر R50i", "expected": [R50I]},
        {"query": "کابل افشان", "expected": [R50I]},
    ]
    assert load_eval().hit_count(client, cases) == 1
