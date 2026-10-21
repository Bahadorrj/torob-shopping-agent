"""Rebuild the committed fixture dataset from the full CSVs.

Usage: python build_fixture.py <full dataset dir>
Rows are copied verbatim; add ids below to extend the fixture.
"""

import csv
import sys
from pathlib import Path

# product_id -> offer ids (verbatim rows from offers.csv)
OFFERS = {
    # Anker R50i: several offers in the Aladdin pasaj, one missing price, one far from median
    "product_92ac53fa75e18e8e73f20b56": [
        "0b260704", "6ba3d2a7", "0456b35a", "05c20a8c", "36be3fe5", "2546da26", "8e542968", "02b30908",
    ],
    "product_13f930f4c1400c7ab7bfa61f": ["af8be5a3", "8a126e25", "0b6f873e", "3953e912", "6d2b5d9e", "23d82bec", "c4d4c603"],
    "product_a0b9dc5ecc796b0f79a33cf3": ["01fc2d9d", "6fbeeeb3", "eda1830c"],
    # title contains a tab
    "product_0b67b5b491a96d23c5ec9d2a": ["ebf2e0d1", "9d38be8b", "672e2cf2"],
    # old price (> 30 days)
    "product_87275da84ee308b9814d5085": ["d5977e91", "caf35d5e"],
    "product_e372fa27c7d7c5c171c14858": ["21a13899", "44fd854c", "e4bfd6ab"],
    "product_df1dfb162403cf73df70fdf3": ["d0b6c2fb", "c111c01c"],
    # hamza (shiaomi) and ZWNJ in title
    "product_3e0ba087e59bbe02a39b6341": ["c663de3f"],
    # Arabic yeh in title, missing price, far from median
    "product_17ecdf2bf4e2e78dc9652a19": ["e091159a", "3f130e01", "9855f8da", "27e41870", "5980e1b2"],
    # every offer missing a price
    "product_c2f4d0a4d9df317cc19b3115": ["ff6f844d", "3e8cc745", "37c570d8"],
    # Persian digits in title
    "product_44b3433a974ba5e14c41803a": ["594eef82", "521807dd", "7e5d1395", "85b1f7c1"],
    # per-meter cable
    "product_5533cda8594ee03ac993685a": ["5e227a21", "133f6193"],
    "product_91fc2714e7673b537827ec61": ["d7ddc2c7"],
    # "1 meter" per-meter price, placeholder price 1
    "product_bd777713ec013d56cf083c9a": ["46e53cc6", "8ee129e2"],
    # "1.8 meter" cable length, invalid price
    "product_a112c972266b57d0f7eddeab": ["1807dc59", "10618e41", "79a3f3e4", "54f9a615"],
    # placeholder price, far from median
    "product_925e0c74f43d3d736ca74bc4": ["c176df38", "7d67e317", "3670a35e", "feaab556", "8d0589e7"],
    # invalid price, missing price, shop with installments
    "product_9c1c0b63163bb432a75dc740": ["7b1397d7", "5b3ac696", "bc6a4d71", "9ea51e3a", "d48464a6"],
    # meter prices next to roll prices
    "product_b96e414eabcbeed813491ff0": ["70a26c16", "79109c67", "b5d4574a", "f80aced6"],
    # hamza (video), multi-shift shop
    "product_1b6783682cab7f15c10b887a": ["91478a4a", "ec597e8f", "c4cb08f5"],
    # Arabic digits in title
    "product_afbeef5118076188aa5de0fb": ["b08968f6", "39e61358", "15ac310c"],
    # no specs, no image
    "product_09415775da3392846abdb072": ["7122a76f"],
    # no price change date
    "product_db75e39a25b2bc83eca25efe": ["d318d621"],
    # shop with a website
    "product_0a040d1b11770040095cec15": ["173e6ad5"],
}

# shops with no offers (category only), in the Aladdin pasaj
EXTRA_SHOPS = ["shop_6492b65ad8b242465783e74d", "shop_d4b7098382f4a0552c80e36b"]


def main(src: Path, dst: Path) -> None:
    csv.field_size_limit(sys.maxsize)
    wanted = {(pid, oid) for pid, oids in OFFERS.items() for oid in oids}

    def copy(name, keep):
        kept = []
        with open(src / name, encoding="utf-8", newline="") as f, open(dst / name, "w", encoding="utf-8", newline="") as out:
            reader = csv.DictReader(f)
            writer = csv.DictWriter(out, reader.fieldnames)
            writer.writeheader()
            for row in reader:
                if keep(row):
                    writer.writerow(row)
                    kept.append(row)
        return kept

    offers = copy("offers.csv", lambda r: (r["product_id"], r["offer_id"][-8:]) in wanted)
    assert len(offers) == len(wanted), f"found {len(offers)} of {len(wanted)} offers"
    copy("products.csv", lambda r: r["product_id"] in OFFERS)
    shop_ids = {r["shop_id"] for r in offers} | set(EXTRA_SHOPS)
    copy("shops.csv", lambda r: r["shop_id"] in shop_ids)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(__file__).parent / "dataset")
