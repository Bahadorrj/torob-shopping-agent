"""Print every shop's Seller Console link, one tab-separated line each: shop_id, name, path.

Usage: python -m pasazhgard.console_links   (reads DATABASE_URL and CONSOLE_SECRET)
"""

import os
import sys

import psycopg

from pasazhgard.inquiries import console_token


def main() -> None:
    secret = os.environ["CONSOLE_SECRET"]
    # shop names are Persian; a Windows console or redirect would otherwise use the ANSI codepage
    sys.stdout.reconfigure(encoding="utf-8")
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for shop_id, name in conn.execute("SELECT shop_id, name FROM shops ORDER BY name"):
            print(f"{shop_id}\t{name}\t/console/{shop_id}?token={console_token(secret, shop_id)}")


if __name__ == "__main__":
    main()
