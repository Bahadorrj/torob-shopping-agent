import { expect, test } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const price = { trust_level: "listed", min_toman: 1000000, max_toman: 2000000, per_meter: false, last_price_changed_at: null, price_age_days: 13, price_age_bucket: "8-30" };
const card = (id: string, title: string) => ({
  product_id: id, title, brand: null, category: null, image_url: null, key_specs: [], offer_count: 8,
  price, price_flags: [], score_parts: [{ word: "هدفون", matched: true }], meaning_match: false,
});
const items = [card("p1", "کالای الف"), card("p2", "کالای ب"), card("p3", "کالای ج")];

test("chat product cards are an RTL carousel with a peek, a top-left compare toggle and a sellers button at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [{ block: "product_cards", query: "هدفون", items }]);
  await page.goto("/");
  await askHome(page, "هدفون");

  const list = page.getByRole("list", { name: "کالاها" });
  const first = list.getByRole("listitem").filter({ hasText: "کالای الف" });
  const second = list.getByRole("listitem").filter({ hasText: "کالای ب" });
  await expect(first).toBeVisible();

  const style = await list.evaluate((el) => {
    const s = getComputedStyle(el);
    return { snap: s.scrollSnapType, bar: s.scrollbarWidth, over: el.scrollWidth - el.clientWidth };
  });
  expect(style.snap).toContain("x");
  expect(style.bar).toBe("none");
  expect(style.over).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  // the first card starts on the right; the second peeks in from the left edge
  const box = (await list.boundingBox())!;
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  expect(Math.abs(a.x + a.width - (box.x + box.width))).toBeLessThan(2);
  expect(b.x).toBeLessThan(box.x);
  expect(b.x + b.width).toBeGreaterThan(box.x + 8);

  // scrolling toward the end (left in RTL) brings the second card in
  await list.evaluate((el) => el.scrollBy({ left: -el.clientWidth, behavior: "instant" }));
  await expect.poll(async () => (await second.boundingBox())!.x).toBeGreaterThanOrEqual(box.x - 1);

  // title is its own heading; sellers is a filled button-sized link
  await expect(first.getByRole("heading", { name: "کالای الف" })).toBeVisible();
  const sellers = second.getByRole("link", { name: "دیدن فروشنده‌ها" });
  await expect(sellers).toBeVisible();
  const s = (await sellers.boundingBox())!;
  expect(s.height).toBeGreaterThanOrEqual(44);
  // not clipped by the scroll row
  expect(s.y + s.height).toBeLessThanOrEqual(box.y + box.height);
  expect(await sellers.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

  // the compare toggle sits in the card's top-left corner and does not navigate
  const toggle = second.getByRole("button", { name: "افزودن به مقایسه" });
  const c = (await second.boundingBox())!;
  const t = (await toggle.boundingBox())!;
  expect(t.x - c.x).toBeLessThan(16);
  expect(t.y - c.y).toBeLessThan(16);
  await toggle.click();
  await expect(second.getByRole("button", { name: "حذف از مقایسه" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/$/);
});
