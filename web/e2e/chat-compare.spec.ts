import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const price = (min: number, max: number) => ({
  trust_level: "listed", min_toman: min, max_toman: max, per_meter: false, last_price_changed_at: null, price_age_days: 3, price_age_bucket: "<=7",
});
const product = (product_id: string, title: string, min: number, max: number, seller_count: number) => ({
  product_id, title, brand: null, image_url: null, price: price(min, max), seller_count,
  warranty: { trust_level: "unknown", sellers: 0, max_months: null },
});
const compareTable = {
  block: "compare_table",
  products: [
    product("p1", "هندزفری بلوتوثی انکر R50i NC با قابلیت حذف نویز", 1690000, 3500000, 4),
    product("p2", "هدفون بی سیم کیو سی وای T13x", 900000, 900000, 2),
    product("p3", "هدفون بی سیم شیائومی Redmi Buds 6 Active", 1200000, 1500000, 0),
  ],
  specs: [
    { key: "نسخه بلوتوث", values: ["5.3", "5.3", "5.3"], differs: false },
    { key: "مقاومت در برابر آب (IP)", values: ["IPX5", null, "IP54"], differs: true },
  ],
};

const column = (offer_id: string, shop_id: string, shop_name: string, extra: object) => ({
  offer_id, shop_id, shop_name, area: "شیخ هادی", pasaj: "علاالدین", floor: null, unit: null, lat: null, lon: null,
  distance_m: 40, price_toman: 3500000, per_meter: false, price_age_days: 2, price_age_bucket: "<=7", trust_level: "listed",
  warranty: null, declared_hours: true, open_now: true, payment_options: [], reasons: [], unknown: [], inquiry: null,
  latest_price: { status: "not_asked", price_toman: null, trust_level: "unknown", at: null },
  travel_min: 1, arrival_at: "2026-10-21T17:01:00+03:30", open_at_arrival: true, fast_delivery: "unknown",
  ...extra,
});
const sellerCompare = {
  block: "seller_compare", product_id: "p1", title: "هندزفری انکر R50i", travel_mode: "walk", travel_estimate: "straight_line",
  sellers: [
    column("o1", "shop_a", "دیسیلا مانسا", { payment_options: [{ provider: "ترب‌پی", channel: "in_person" }] }),
    column("o2", "shop_b", "نیین ماهیس", {
      open_at_arrival: false,
      latest_price: { status: "confirmed", price_toman: 3300000, trust_level: "confirmed", at: "2026-10-21T12:00:00+03:30" },
    }),
    column("o3", "shop_c", "نیکورا ویوان", { distance_m: null, travel_min: null, open_at_arrival: null }),
  ],
};

test("compare_table and seller_compare blocks show their tables inline at 360 px with links to the full pages", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [compareTable, sellerCompare]);
  await page.goto("/");
  await askHome(page, "این سه را مقایسه کن");
  const sheet = page.getByRole("region", { name: "دستیار" });

  const products = sheet.getByRole("table", { name: "مقایسه کالاها" });
  await expect(products.getByRole("columnheader")).toHaveCount(3);
  await expect(products.getByRole("row", { name: /قیمت/ })).toContainText("۱٫۶۹۰٫۰۰۰ تا ۳٫۵۰۰٫۰۰۰ تومان");
  await expect(products.getByRole("row", { name: /قیمت/ })).toContainText("۹۰۰٫۰۰۰ تومان");
  await expect(products.getByRole("row", { name: /فروشنده/ })).toContainText("۴ فروشنده");
  // only the specs that differ
  await expect(products.getByRole("row", { name: /مقاومت در برابر آب/ })).toContainText("IPX۵");
  await expect(products.getByText("نسخه بلوتوث")).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: "دیدن جدول مقایسه" })).toHaveAttribute("href", "/compare?ids=p1%2Cp2%2Cp3");

  const sellers = sheet.getByRole("table", { name: "مقایسه فروشنده‌ها" });
  await expect(sellers.getByRole("columnheader")).toHaveCount(3);
  const priceRow = sellers.getByRole("row", { name: /قیمت/ });
  await expect(priceRow).toContainText("۳٫۵۰۰٫۰۰۰ تومان");
  await expect(priceRow).toContainText("ثبت‌شده");
  await expect(priceRow).toContainText("۳٫۳۰۰٫۰۰۰ تومان");
  await expect(priceRow).toContainText("تأییدشده");
  await expect(sellers.getByRole("row", { name: /فاصله/ })).toContainText("دقیقه");
  await expect(sellers.getByRole("row", { name: /باز در زمان رسیدن/ })).toContainText("بسته");
  await expect(sellers.getByRole("row", { name: /اقساط/ })).toContainText("ترب‌پی");
  await expect(sheet.getByRole("link", { name: "مقایسه فروشنده‌ها" })).toHaveAttribute(
    "href",
    "/products/p1/sellers/compare?offer=o1&offer=o2&offer=o3",
  );
  expect(await overflow(page)).toBe(0);
});
