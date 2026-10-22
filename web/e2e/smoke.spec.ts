import { expect, test } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

test("home renders at 360 px without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "پاساژگرد" })).toBeVisible();
  await expect(page.getByLabel("خرید شما در یک جمله")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("a price without a change date is not also called old", async ({ page }) => {
  const price = {
    trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false,
    last_price_changed_at: null, price_age_days: null, price_age_bucket: null,
  };
  const item = { brand: null, category: null, image_url: null, key_specs: [], offer_count: 1, price_flags: [], score_parts: [], meaning_match: false };
  await fakeSessions(page, {});
  await fakeAgent(page, [{
    block: "product_cards",
    query: "x",
    items: [
      { ...item, product_id: "undated", title: "کالای الف", price },
      { ...item, product_id: "old", title: "کالای ب", price: { ...price, price_age_days: 45, price_age_bucket: ">30" } },
    ],
  }]);
  await page.goto("/");
  await askHome(page, "x");
  const undated = page.getByRole("listitem").filter({ hasText: "کالای الف" });
  await expect(undated.getByText("تاریخ تغییر قیمت ثبت نشده")).toBeVisible();
  await expect(undated.getByText("قیمت قدیمی")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "کالای ب" }).getByText("قیمت قدیمی")).toBeVisible();
});
