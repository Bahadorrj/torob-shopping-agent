"""Cleaning rules: one raw CSV row in, one cleaned record out."""

import json
import re
from collections import defaultdict
from datetime import datetime
from statistics import median

from pasazhgard.normalize import normalize

PLACEHOLDER_BELOW = 1_000
INVALID_ABOVE = 10**10
BAD_PRICE_FLAGS = {"missing", "placeholder", "invalid"}

_METRI = re.compile(r"(?<!\w)متری(?!\w)")
_PER_METER = re.compile(r"هر متر(?!\w)|^یک متر ")


def _null(value: str) -> str | None:
    return None if value in ("", "null") else value


def _json_list(value: str) -> list:
    return json.loads(value) if _null(value) else []


def is_per_meter(seller_title: str) -> bool:
    # a word before "متری" that makes it a length ("100 متری", "سانتی متری") rather than a unit price
    length_words = set(
        "دو سه چهار پنج شش هفت هشت نه ده بیست سی چهل پنجاه شصت هفتاد هشتاد نود صد دویست سیصد پانصد هزار"
        " نیم ونیم سانت سانتی میلی کیلو".split()
    )
    text = normalize(seller_title)
    if _PER_METER.search(text):
        return True
    for m in _METRI.finditer(text):
        before = text[: m.start()]
        # "1 متری" and a cable size such as "4*10 متری" or "2 در 1.5 متری" price one meter
        if re.search(r"(?<![\w.])(1|یک)\W*$|\d\s*([*×x]|در)\s*\d+([./]\d+)?\W*$", before):
            return True
        last = re.search(r"(\d|[^\W\d_]+)\W*$", before)
        if not last or not (last[1].isdigit() or last[1] in length_words):
            return True
    return False


def clean_offer(row: dict) -> dict:
    price = _null(row["price_toman"])
    price = int(price) if price else None
    flags = []
    if price is None:
        flags.append("missing")
    elif price < PLACEHOLDER_BELOW:
        flags.append("placeholder")
    elif price > INVALID_ABOVE:
        flags.append("invalid")
    if is_per_meter(row["seller_title"]):
        flags.append("per_meter")
    changed = _null(row["last_price_changed_at"])
    return {
        "offer_id": row["offer_id"],
        "product_id": row["product_id"],
        "shop_id": row["shop_id"],
        "seller_title": row["seller_title"],
        "price_toman": price,
        "last_price_changed_at": datetime.fromisoformat(changed) if changed else None,
        "price_flags": flags,
    }


def flag_far_from_median(offers: list[dict]) -> None:
    """Flag valid prices far from the median of their product's valid prices in the same unit."""
    groups = defaultdict(list)
    for o in offers:
        if not BAD_PRICE_FLAGS & set(o["price_flags"]):
            groups[o["product_id"], "per_meter" in o["price_flags"]].append(o)
    for group in groups.values():
        # far means under 0.5x or over 2x the median; with two prices the median is their mean, so skip
        if len(group) < 3:
            continue
        mid = median(o["price_toman"] for o in group)
        for o in group:
            if not mid / 2 <= o["price_toman"] <= mid * 2:
                o["price_flags"].append("far_from_median")


def clean_product(row: dict) -> dict:
    title, brand, model = row["persian_title"], _null(row["brand_name"]), _null(row["model"])
    return {
        "product_id": row["product_id"],
        "title": title,
        "brand": brand,
        "category": _null(row["category_name"]),
        "model": model,
        "image_urls": _json_list(row["image_urls"]),
        "specs": [{"key": s["key"], "value": s["value"]} for s in _json_list(row["specs"])],
        "search_text": normalize(" ".join(filter(None, [title, brand, model]))),
    }
