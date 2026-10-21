import { expect, test } from "@playwright/test";

test("home renders at 360 px without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "پاساژگرد" })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("a price without a change date is not also called old", async ({ page }) => {
  const price = {
    trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false,
    last_price_changed_at: null, price_age_days: null, price_age_bucket: ">30",
  };
  const item = { brand: null, category: null, image_url: null, key_specs: [], offer_count: 1, price_flags: [] };
  await page.route("**/api/products/search?*", (route) =>
    route.fulfill({
      json: {
        query: "x",
        items: [
          { ...item, product_id: "undated", title: "کالای الف", price },
          { ...item, product_id: "old", title: "کالای ب", price: { ...price, price_age_days: 45 } },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("جستجوی کالا").fill("x");
  await page.getByRole("button", { name: "جستجو" }).click();
  const undated = page.getByRole("listitem").filter({ hasText: "کالای الف" });
  await expect(undated.getByText("تاریخ تغییر قیمت ثبت نشده")).toBeVisible();
  await expect(undated.getByText("قیمت قدیمی")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "کالای ب" }).getByText("قیمت قدیمی")).toBeVisible();
});
