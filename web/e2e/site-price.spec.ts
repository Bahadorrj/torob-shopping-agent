import { expect, test } from "@playwright/test";

import { fakeSessions } from "./fake-session";

const AT = "2026-10-21T12:05:00+03:30";

const column = (offer_id: string, shop_id: string, shop_name: string, latest_price: object) => ({
  offer_id,
  shop_id,
  shop_name,
  area: "لاله‌زار",
  pasaj: null,
  floor: null,
  unit: null,
  lat: null,
  lon: null,
  distance_m: null,
  price_toman: 524000,
  per_meter: false,
  price_age_days: 14,
  price_age_bucket: "8-30",
  trust_level: "listed",
  warranty: null,
  declared_hours: false,
  open_now: null,
  payment_options: [],
  reasons: [],
  unknown: [],
  latest_price,
  inquiry: null,
  travel_min: null,
  arrival_at: "2026-10-21T12:00:00+03:30",
  open_at_arrival: null,
  fast_delivery: "unknown",
});

const sitePrice = (shop_id: string, shop_name: string, price_toman: number | null) => ({
  shop_id,
  shop_name,
  product_id: "p1",
  status: price_toman ? "found" : "unavailable",
  price_toman,
  trust_level: "website_price",
  fetched_at: AT,
  url: "https://example.ir/?s=x",
});

test("a website price shows with its fetch time and no stock claim; an unavailable one offers an inquiry at 360 px", async ({ page }) => {
  await fakeSessions(page, {}, { s9: {} });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "s9"));
  const sellers = [
    column("o1", "shop_a", "سیم و کابل مهدی", { status: "website", price_toman: 580000, trust_level: "website_price", at: AT }),
    column("o2", "shop_b", "نیین ماهیس", { status: "not_asked", price_toman: null, trust_level: "unknown", at: null }),
  ];
  await page.route("**/api/products/p1/sellers/compare**", (route) =>
    route.fulfill({ json: { product_id: "p1", title: "کابل افشان", travel_mode: "walk", travel_estimate: "straight_line", sellers } }),
  );
  const composed: object[] = [];
  const status = { inquiries: [], site_prices: [sitePrice("shop_a", "سیم و کابل مهدی", 580000), sitePrice("shop_b", "نیین ماهیس", null)] };
  await page.route("**/api/sessions/*/inquiries**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/stream"))
      return route.fulfill({ contentType: "text/event-stream", body: `retry: 100\ndata: ${JSON.stringify(status)}\n\n` });
    composed.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { inquiries: [] } });
  });
  await page.goto("/products/p1/sellers/compare?offer=o1&offer=o2");

  const table = page.getByRole("table");
  const row = (name: string) => table.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
  await expect(row("آخرین قیمت")).toContainText("۵۸۰٬۰۰۰ تومان");
  await expect(row("آخرین قیمت")).toContainText("سایت فروشنده - ساعت ۱۲:۰۵");
  await expect(row("آخرین قیمت")).toContainText("موجودی تأیید نشده");
  await expect(row("اعتبار قیمت")).toContainText("قیمت سایت");

  const tracker = page.getByRole("region", { name: "استعلام‌ها" });
  await expect(tracker.getByRole("heading", { name: "قیمت سایت فروشنده‌ها" })).toBeVisible();
  await expect(tracker).toContainText("قیمت سایت: ۵۸۰٬۰۰۰ تومان - ساعت ۱۲:۰۵ - موجودی تأیید نشده");
  await expect(tracker).toContainText("قیمت سایت در دسترس نبود");
  await tracker.getByRole("button", { name: "استعلام از نیین ماهیس" }).click();
  await expect.poll(() => composed).toEqual([{ offer_ids: [], asks: [{ product_id: "p1", shop_id: "shop_b" }] }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
