import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

const style = (page: Page, selector: string, props: string[]) =>
  page.locator(selector).first().evaluate((el, props) => {
    const s = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)]));
  }, props);

test("the page ground is slate, a card is white, flat and 16 px round", async ({ page }) => {
  const price = { trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false, last_price_changed_at: null, price_age_days: 3, price_age_bucket: "<=7" };
  const item = { product_id: "p1", title: "کالای الف", brand: null, category: null, image_url: null, key_specs: [], offer_count: 1, price, price_flags: [], score_parts: [], meaning_match: false };
  await fakeSessions(page, {});
  await fakeAgent(page, [{ block: "product_cards", query: "x", items: [item] }]);
  await page.goto("/");
  expect(await style(page, "body", ["background-color", "color"])).toEqual({ "background-color": "rgb(241, 245, 249)", color: "rgb(30, 41, 59)" });

  await askHome(page, "x");
  await expect(page.locator("[data-slot=card]").first()).toBeVisible();
  expect(await style(page, "[data-slot=card]", ["background-color", "box-shadow", "border-radius"])).toEqual({
    "background-color": "rgb(255, 255, 255)",
    "box-shadow": "none",
    "border-radius": "16px",
  });
  await noOverflow(page);
});

test("prices group thousands with U+066B", async ({ page }) => {
  const row = {
    offer_id: "o1", shop_id: "shop_a", shop_name: "دیسیلا مانسا", area: "شیخ هادی", pasaj: null, floor: null, unit: null,
    distance_m: 40, price_toman: 3500000, per_meter: false, price_age_days: 22, price_age_bucket: "8-30", trust_level: "listed",
    warranty: null, declared_hours: false, open_now: null, payment_options: [], unknown: [], reasons: [],
  };
  const list = { product_id: "p1", title: "هندزفری انکر R50i", count: 1, sellers: [row], ask_them: [], category_only: [], nearest_covered: null, areas: [], pasajs: [] };
  await fakeSessions(page, { sellers: () => list });
  await page.goto("/products/p1/sellers");
  await expect(page.getByRole("listitem").filter({ hasText: row.shop_name })).toContainText("۳٫۵۰۰٫۰۰۰ تومان");
  await noOverflow(page);
});

test("an unknown shop value reads نامشخص in muted slate, never ثبت نشده", async ({ page }) => {
  const days = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
  const shop = {
    shop_id: "shop_unknown", name: "آریلا مانوان", address: null, pasaj: null, floor: null, unit: null, landmark: null,
    hours: { timezone: "Asia/Tehran", today: "wed", week: days.map((day) => ({ day, status: "unknown", shifts: [] })) },
    payment_options: [{ provider: "ترب‌پی", channel: "unknown" }], fast_delivery: "unknown", website_url: null, instagram_url: null,
  };
  await page.route("**/api/shops/shop_unknown", (route) => route.fulfill({ json: shop }));
  await page.goto("/shops/shop_unknown");
  await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();

  const unknown = page.getByText("نامشخص", { exact: true });
  await expect(unknown.first()).toBeVisible();
  for (const color of await unknown.evaluateAll((els) => els.map((el) => getComputedStyle(el).color))) expect(color).toBe("rgb(100, 116, 139)");
  await expect(page.getByText("ثبت نشده")).toHaveCount(0);
  await noOverflow(page);
});

test("plan map links are contact-outline and the share button is buy", async ({ page }) => {
  const links = { neshan: "https://nshn.ir/", balad: "https://balad.ir/", google: "https://www.google.com/maps/" };
  const plan = {
    origin: { lat: 35.69, lon: 51.42 }, depart_at: "2026-10-22T13:35:00+03:30", nudges: [], mode: "walk",
    stops: [{
      shop_id: "shop_a", shop_name: "آذرنوش دیسیس", lat: 35.6949, lon: 51.4115, route: { distance_m: 1000, duration_min: 10, source: "neshan" },
      links, last_leg: { pasaj: null, landmark: null, floor: null, unit: null }, eta: "2026-10-22T13:45:00+03:30", open_at_eta: true, inquiry: null,
    }],
  };
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("**/api/visit-plan?**", (route) => route.fulfill({ json: plan }));
  await fakeSessions(page, {});
  await page.goto("/plan?shop_id=shop_a&lat=35.69&lon=51.42&mode=walk");

  const link = page.getByRole("link", { name: "باز کردن در نشان" });
  await expect(link).toBeVisible();
  const linkStyle = await link.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.color, s.borderTopColor];
  });
  expect(linkStyle).toEqual(["rgb(52, 104, 204)", "rgb(52, 104, 204)"]);
  const share = page.getByRole("button", { name: "اشتراک‌گذاری برنامه" });
  expect(await share.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(215, 57, 72)");
  await noOverflow(page);
});
