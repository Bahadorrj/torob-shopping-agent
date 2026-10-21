"""Cleaning rules: one raw CSV row in, one cleaned record out."""

import json
import re
from collections import defaultdict
from datetime import datetime
from enum import StrEnum
from statistics import median

from pasazhgard.normalize import normalize


class PriceFlag(StrEnum):
    """Offer price flags, in display order. Mirrored in web/lib/api.ts."""

    MISSING = "missing"
    PLACEHOLDER = "placeholder"
    INVALID = "invalid"
    PER_METER = "per_meter"
    FAR_FROM_MEDIAN = "far_from_median"


BAD_PRICE_FLAGS = {PriceFlag.MISSING, PriceFlag.PLACEHOLDER, PriceFlag.INVALID}


def _null(value: str) -> str | None:
    return None if value in ("", "null") else value


def _json_list(value: str) -> list:
    return json.loads(value) if _null(value) else []


def is_per_meter(seller_title: str) -> bool:
    # a word before "متری" that makes it a length ("100 متری", "سانتی متری") rather than a unit price
    length_words = set(
        "یک دو سه چهار پنج شش هفت هشت نه ده بیست سی چهل پنجاه شصت هفتاد هشتاد نود صد دویست سیصد پانصد هزار"
        " نیم ونیم سانت سانتی میلی کیلو".split()
    )
    metri = re.compile(r"(?<!\w)متری(?!\w)")
    per_meter = re.compile(r"هر متر(?!\w)|^یک متر(?!\w)")
    # a "1 متری" cable, rail or hose is usually one piece; only wire-like goods sold by length price one meter
    by_length = re.compile(r"سیم|افشان|ریسه|نیون")  # normalize turns the hamza in نئون into ی
    one_meter = re.compile(r"(?<![\w.])(1|یک)\W*$")
    # a cable size such as "4*10" or "2 در 1.5" before "متری"
    cable_size = re.compile(r"\d\s*([*×x]|در)\s*\d+([./]\d+)?\W*$")
    text = normalize(seller_title)
    if per_meter.search(text):
        return True
    wire = by_length.search(text)
    if wire and re.search(r"(?<!\w)یک متر(?!\w)", text):
        return True
    for m in metri.finditer(text):
        before = text[: m.start()]
        if wire and one_meter.search(before):
            return True
        if (wire or "کابل" in text) and cable_size.search(before):
            return True
        last = re.search(r"(\d|[^\W\d_]+)\W*$", before)
        if not last or not (last[1].isdigit() or last[1] in length_words):
            return True
    return False


def clean_offer(row: dict) -> dict:
    placeholder_below, invalid_above = 1_000, 10**10
    price = _null(row["price_toman"])
    price = int(price) if price else None
    flags = []
    if price is None:
        flags.append(PriceFlag.MISSING)
    elif price < placeholder_below:
        flags.append(PriceFlag.PLACEHOLDER)
    elif price > invalid_above:
        flags.append(PriceFlag.INVALID)
    if is_per_meter(row["seller_title"]):
        flags.append(PriceFlag.PER_METER)
    changed = _null(row["last_price_changed_at"])
    return {
        "offer_id": row["offer_id"],
        "product_id": row["product_id"],
        "shop_id": row["shop_id"],
        "seller_title": row["seller_title"],
        "price_toman": price,
        "last_price_changed_at": datetime.fromisoformat(changed) if changed else None,
        "price_flags": flags,
        "warranty": clean_warranty(row["warranty"]),
    }


def flag_far_from_median(offers: list[dict]) -> None:
    """Flag valid prices far from the median of their product's valid prices in the same unit."""
    groups = defaultdict(list)
    for o in offers:
        if not BAD_PRICE_FLAGS & set(o["price_flags"]):
            groups[o["product_id"], PriceFlag.PER_METER in o["price_flags"]].append(o)
    for group in groups.values():
        # far means under 0.5x or over 2x the median; with two prices the median is their mean, so skip
        if len(group) < 3:
            continue
        mid = median(o["price_toman"] for o in group)
        for o in group:
            if not mid / 2 <= o["price_toman"] <= mid * 2:
                o["price_flags"].append(PriceFlag.FAR_FROM_MEDIAN)


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


# Iranian week order; datetime.weekday() of sat is 5, hence WEEK[(weekday + 2) % 7]
WEEK = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]


def clean_hours(raw: str) -> dict:
    """Weekly hours, sat..fri, in Asia/Tehran local time. A shop without hours is `unknown` every day."""
    days = json.loads(raw) if _null(raw) else {}
    hours = {}
    for key in WEEK:
        day = days.get(key)
        if not day:
            hours[key] = {"status": "unknown", "shifts": []}
            continue
        shifts = [
            {"start": s["start_time"][:5], "end": s["end_time"][:5]}
            for s in day["shifts"]
            if not s["start_time"] == s["end_time"] == "00:00:00"
        ]
        # closed and unsupported days only carry placeholder shifts
        hours[key] = {"status": day["status"], "shifts": shifts if day["status"] == "declared" else []}
    return hours


def parse_address(address: str) -> dict:
    """Pasaj, floor, unit and the landmark nearest the shop. Display strings keep their raw spelling."""
    landmark_words = re.compile(r"^(نبش|روبروی|روبه روی|رو به روی|جنب|کنار|مقابل|پشت|نرسیده|بعد از|قبل از|بین|سر کوچه|بالاتر از|پایین تر از)(?!\w)")
    # "پاساژ" is often glued to the name ("پاساژعلاالدین")
    pasaj_re = re.compile(r"(?:پاسا[ژز]|(?:مجتمع(?:\s*تجاری)?|بازار|سرای|ساختمان)(?!\w))\s*(.+?)(?=\s*(?:طبقه|پلاک|واحد|$))")
    floor_re = re.compile(r"طبقه(?:\s*ی)?\s*(.+?)(?=\s*(?:پلاک|واحد|$))")
    unit_re = re.compile(r"واحد\s*(.+?)(?=\s*(?:پلاک|طبقه|$))")
    plate_re = re.compile(r"پلاک\s*(.+?)(?=\s*(?:واحد|طبقه|$))")
    # spellings of one pasaj name; normalize already folds علاءالدین into علاالدین
    variants = {"علالدین": "علاالدین", "علایدین": "علاالدین", "چهارسو": "چارسو"}
    pasaj = floor = unit = plate = landmark = None
    for segment in (s.strip() for s in re.split(r"[،,٬]", address or "")):
        if landmark_words.search(normalize(segment)):
            landmark = segment
            continue
        if pasaj is None and (m := pasaj_re.search(segment)):
            pasaj = " ".join(variants.get(w, w) for w in normalize(m[1]).split())
        floor = floor or ((m := floor_re.search(segment)) and m[1])
        unit = unit or ((m := unit_re.search(segment)) and m[1])
        plate = plate or ((m := plate_re.search(segment)) and m[1])
    # a plate outside a pasaj or floor is a street number, not a unit
    if unit is None and (pasaj or floor):
        unit = plate
    return {"pasaj": pasaj, "floor": floor, "unit": unit, "landmark": landmark}


def clean_payment_options(raw: str) -> list[dict]:
    return [
        {"provider": p["provider_name"], "channel": "in_person" if p["channel"] == "in_person" else "unknown"}
        for p in _json_list(raw)
    ]


def fast_delivery(raw: str) -> str:
    return {"true": "yes", "false": "no"}.get(raw, "unknown")


def clean_warranty(raw: str) -> dict | None:
    """An offer's warranty, or None when the offer does not say."""
    w = json.loads(raw) if _null(raw) else {}
    provider, months = w.get("provider"), w.get("period_months")
    # the source writes a missing description as the string "None"
    description = None if w.get("description") == "None" else w.get("description")
    if not (provider or description or months):
        return None
    text = normalize(f"{provider or ''} {description or ''}")
    if "بدون گارانتی" in text:
        return {"kind": "none", "provider": None, "months": None, "description": None}
    if "تست و تحویل در حضور مشتری" in text:
        return {"kind": "test_in_presence", "provider": None, "months": None, "description": None}
    # else the first period in months or years, e.g. "7 روز مهلت تست و 6 ماه گارانتی" is 6 months
    if months is None and (m := re.search(r"(\d+)\s*(ماه|سال)", text)):
        months = int(m[1]) * (12 if m[2] == "سال" else 1)
    return {"kind": "warranty", "provider": provider, "months": months, "description": description}


def clean_shop(row: dict) -> dict:
    instagram = json.loads(row["instagram"]) if _null(row["instagram"]) else {}
    return {
        "shop_id": row["shop_id"],
        "name": row["name"],
        "address": _null(row["address"]),
        "location_label": _null(row["location_label"]),
        "lat": float(row["lat"]) if _null(row["lat"]) else None,
        "lon": float(row["lon"]) if _null(row["lon"]) else None,
        "categories": _json_list(row["category_names"]),
        **parse_address(_null(row["address"]) or ""),
        "hours": clean_hours(row["weekly_hours"]),
        "payment_options": clean_payment_options(row["payment_options"]),
        "fast_delivery": fast_delivery(row["supports_fast_delivery"]),
        "website_url": _null(row["website_url"]),
        "instagram_url": instagram.get("profile_url"),
    }
