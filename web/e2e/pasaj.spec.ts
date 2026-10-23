import { expect, test, type Page } from "@playwright/test";

import { fakeSessions } from "./fake-session";

const shop = (id: string, name: string, unit: string | null, products: object[] = []) => ({ shop_id: id, shop_name: name, unit, products });
const r50i = { product_id: "p1", title: "هندزفری انکر R50i", price_toman: 3500000 };

const view = {
  pasaj: "علاالدین 2",
  count: 3,
  floors: [
    { floor: "زیر همکف", level: -1, shops: [shop("shop_a", "دیسیلا مانسا", "44", [r50i])] },
    { floor: "۲", level: 2, shops: [shop("shop_b", "نیکورا ویوان", "216", [{ ...r50i, price_toman: null }])] },
    { floor: null, level: null, shops: [shop("shop_c", "دیسآرا مانوش", null)] },
  ],
};

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function fakePasaj(page: Page) {
  const asked: URL[] = [];
  await page.route("**/api/pasajs/**", (route) => {
    asked.push(new URL(route.request().url()));
    return route.fulfill({ json: view });
  });
  return asked;
}

test("pasaj view groups shops by floor, unknown floors last, at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  const asked = await fakePasaj(page);
  await page.goto(`/pasajs/${encodeURIComponent("علاالدین 2")}?product=p1`);
  await expect(page.getByRole("heading", { name: "پاساژ علاالدین ۲" })).toBeVisible();

  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["طبقه زیر همکف", "طبقه ۲", "طبقه: نامشخص"]);
  const first = page.getByRole("region", { name: "طبقه زیر همکف" }).getByRole("listitem").first();
  await expect(first.getByRole("link", { name: "دیسیلا مانسا" })).toHaveAttribute("href", "/shops/shop_a");
  await expect(first).toContainText("واحد ۴۴");
  await expect(first).toContainText("۳٫۵۰۰٫۰۰۰ تومان");
  await expect(page.getByRole("region", { name: "طبقه ۲" })).toContainText("قیمت: نامشخص");
  await expect(page.getByRole("region", { name: "طبقه: نامشخص" })).toContainText("دیسآرا مانوش");
  expect(await noOverflow(page)).toBe(0);

  // the brief rides along, so the view matches its items too
  const last = asked.at(-1)!;
  expect(decodeURIComponent(last.pathname)).toBe("/api/pasajs/علاالدین 2");
  expect(last.searchParams.getAll("product_id")).toEqual(["p1"]);
  expect(last.searchParams.get("session_id")).toBe("s1");
});

test("a pasaj pin on the map opens the pasaj view", async ({ page }) => {
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const row = {
    offer_id: "o_a", shop_id: "shop_a", shop_name: "دیسیلا مانسا", area: "شیخ هادی", pasaj: "علاالدین 2", floor: "3", unit: "327",
    lat: 35.6948, lon: 51.4115, distance_m: null, price_toman: 3500000, per_meter: false, price_age_days: 22, price_age_bucket: "8-30",
    trust_level: "listed", warranty: null, declared_hours: false, open_now: null, payment_options: [], unknown: [], reasons: [],
  };
  await fakeSessions(page, {
    sellers: () => ({
      product_id: "p1", title: "هندزفری انکر R50i", count: 1, sellers: [row], ask_them: [], category_only: [], nearest_covered: null, areas: [], pasajs: [],
    }),
  });
  await fakePasaj(page);
  await page.goto("/products/p1/sellers");
  await page.getByRole("button", { name: "نقشه", exact: true }).click();
  await page.getByRole("button", { name: /پاساژ علاالدین ۲/ }).click();
  await page.getByRole("link", { name: "همه فروشگاه‌های این پاساژ" }).click();
  await expect(page).toHaveURL(/\/pasajs\/.+\?product=p1$/);
  await expect(page.getByRole("heading", { name: "پاساژ علاالدین ۲" })).toBeVisible();
});

test("a shop page links to its pasaj view", async ({ page }) => {
  await fakeSessions(page, {});
  await fakePasaj(page);
  const days = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
  await page.route("**/api/shops/shop_a", (route) =>
    route.fulfill({
      json: {
        shop_id: "shop_a", name: "دیسیلا مانسا", address: null, pasaj: "علاالدین 2", floor: "3", unit: "327", landmark: null,
        hours: { timezone: "Asia/Tehran", today: "wed", week: days.map((day) => ({ day, status: "unknown", shifts: [] })) },
        payment_options: [], fast_delivery: "unknown", website_url: null, instagram_url: null,
      },
    }),
  );
  await page.goto("/shops/shop_a");
  await page.getByRole("link", { name: "همه فروشگاه‌های این پاساژ" }).click();
  await expect(page.getByRole("heading", { name: "پاساژ علاالدین ۲" })).toBeVisible();
});

test("pasaj view still shows when no session can be made", async ({ page }) => {
  await page.route("**/api/sessions**", (route) => route.fulfill({ status: 500, json: {} }));
  const asked = await fakePasaj(page);
  await page.goto(`/pasajs/${encodeURIComponent("علاالدین 2")}?product=p1`);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["طبقه زیر همکف", "طبقه ۲", "طبقه: نامشخص"]);
  expect(asked.at(-1)!.searchParams.has("session_id")).toBe(false);
});

test("a pasaj with none of your items shows the coverage note", async ({ page }) => {
  await fakeSessions(page, {});
  await page.route("**/api/pasajs/**", (route) => route.fulfill({ json: { ...view, count: 0, floors: [] } }));
  await page.goto(`/pasajs/${encodeURIComponent("علاالدین 2")}`);
  await expect(page.getByText("در این پاساژ فروشگاهی کالاهای شما را ثبت نکرده است.")).toBeVisible();
  await expect(page.getByText("داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.")).toBeVisible();
});
