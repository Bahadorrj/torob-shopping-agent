import { expect, test, type Page } from "@playwright/test";

import { fakeSessions } from "./fake-session";

const seller = (id: string, name: string, extra: object) => ({
  offer_id: `o_${id}`,
  shop_id: id,
  shop_name: name,
  area: "شیخ هادی",
  pasaj: "علاالدین 2",
  floor: "3",
  unit: "327",
  lat: 35.6948,
  lon: 51.4115,
  distance_m: null,
  price_toman: 3500000,
  per_meter: false,
  price_age_days: 22,
  price_age_bucket: "8-30",
  trust_level: "listed",
  warranty: null,
  declared_hours: false,
  open_now: null,
  payment_options: [],
  unknown: [],
  reasons: [],
  ...extra,
});

const a = seller("shop_a", "دیسیلا مانسا", {});
const b = seller("shop_b", "نیکورا ویوان", { lon: 51.4116, price_toman: 3400000 });
const c = seller("shop_c", "دیسآرا مانوش", { pasaj: null, lat: 35.6858, lon: 51.4206, price_toman: null, trust_level: "unknown" });
const nowhere = seller("shop_d", "آذرنوش دیسیس", { pasaj: null, lat: null, lon: null });

const list = (sellers: object[]) => ({
  product_id: "p1",
  title: "هندزفری انکر R50i",
  count: sellers.length,
  sellers,
  ask_them: [],
  category_only: [],
  nearest_covered: null,
  areas: ["شیخ هادی", "فردوسی"],
  pasajs: ["علاالدین 2"],
});

async function open(page: Page, respond: (brief: Record<string, unknown>) => object) {
  // no tile server in tests
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  const { patches } = await fakeSessions(page, { sellers: respond });
  await page.goto("/products/p1/sellers");
  await expect(page.getByRole("heading", { name: "هندزفری انکر R50i" })).toBeVisible();
  return patches;
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("map pins cluster one pasaj, tapping one shows its shops, the toggle keeps filters and selection", async ({ page }) => {
  const patches = await open(page, (brief) => ((brief.area as { name?: string } | null)?.name ? list([c]) : list([a, b, c, nowhere])));
  await page.getByRole("button", { name: "نقشه", exact: true }).click();

  const pins = page.getByRole("button", { name: /فروشنده روی نقشه/ });
  await expect(pins).toHaveCount(2);
  await expect(page.getByText("۱ فروشنده موقعیت ثبت‌شده ندارد")).toBeVisible();
  expect(await noOverflow(page)).toBe(0);

  await page.getByRole("button", { name: "پاساژ علاالدین ۲: ۲ فروشنده روی نقشه" }).click();
  const picked = page.getByRole("region", { name: "پاساژ علاالدین ۲" });
  await expect(picked.getByRole("listitem")).toHaveCount(2);
  const first = picked.getByRole("listitem").filter({ hasText: a.shop_name });
  await expect(first).toContainText("۳٬۵۰۰٬۰۰۰ تومان");
  await expect(first).toContainText("قیمت ثبت‌شده");
  await expect(first.getByRole("link", { name: "صفحه فروشگاه" })).toHaveAttribute("href", "/shops/shop_a");
  expect(await noOverflow(page)).toBe(0);

  const sent = patches.length;
  await page.getByRole("button", { name: "فهرست", exact: true }).click();
  await expect(page.locator("li[aria-current=true]")).toHaveCount(2);
  await page.getByRole("button", { name: "نقشه", exact: true }).click();
  await expect(picked.getByRole("listitem")).toHaveCount(2);
  expect(patches.length).toBe(sent);

  // a filter change while on the map redraws the pins and stays on the map
  await page.getByRole("region", { name: "خلاصه خرید" }).getByRole("button", { name: /^محدوده/ }).click();
  await page.getByLabel("انتخاب محدوده").selectOption({ label: "فردوسی" });
  await expect(pins).toHaveCount(1);
  await expect(page.getByRole("button", { name: "نقشه", exact: true })).toHaveAttribute("aria-pressed", "true");
});
