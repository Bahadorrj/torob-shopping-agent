import { expect, test, type Page } from "@playwright/test";

import { emptyBrief, fakeSessions } from "./fake-session";

const seller = (offer_id: string, shop_id: string, shop_name: string) => ({
  offer_id,
  shop_id,
  shop_name,
  area: "شیخ هادی",
  pasaj: "علاالدین",
  floor: null,
  unit: null,
  distance_m: 40,
  price_toman: 3500000,
  per_meter: false,
  price_age_days: 22,
  price_age_bucket: "8-30",
  trust_level: "listed",
  warranty: { kind: "warranty", provider: null, months: 18, description: null },
  declared_hours: true,
  open_now: true,
  payment_options: [{ provider: "اسنپ‌پی", channel: "in_person" }],
  reasons: [],
  unknown: [],
});

const sellers = [
  seller("o1", "shop_a", "دیسیلا مانسا"),
  seller("o2", "shop_b", "نیین ماهیس"),
  seller("o3", "shop_c", "نیکورا ویوان"),
  seller("o4", "shop_d", "آذرنوش دیسیس"),
];

const list = {
  product_id: "p1",
  title: "هندزفری انکر R50i",
  count: 4,
  sellers,
  ask_them: [],
  category_only: [],
  nearest_covered: null,
  areas: [],
  pasajs: [],
};

const known = {
  ...sellers[0],
  travel_min: 1,
  arrival_at: "2026-10-21T17:01:00+03:30",
  open_at_arrival: true,
  fast_delivery: "yes",
  latest_price: { status: "not_asked", price_toman: null, trust_level: "unknown", at: null },
};

const unknown = {
  ...known,
  ...sellers[1],
  distance_m: null,
  travel_min: null,
  price_toman: null,
  price_age_days: null,
  price_age_bucket: null,
  trust_level: "unknown",
  warranty: null,
  payment_options: [],
  open_at_arrival: null,
  fast_delivery: "unknown",
};

const compared = { product_id: "p1", title: list.title, travel_mode: "walk", travel_estimate: "straight_line", sellers: [known, unknown, { ...known, ...sellers[2], fast_delivery: "no" }] };

async function fakeCompare(page: Page) {
  const requests: URLSearchParams[] = [];
  await page.route("**/api/products/p1/sellers/compare**", (route) => {
    const q = new URL(route.request().url()).searchParams;
    requests.push(q);
    // the API echoes the travel mode it estimated with
    return route.fulfill({ json: { ...compared, travel_mode: q.get("mode") ?? "walk" } });
  });
  return requests;
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("pick up to three sellers from the list and open the compare", async ({ page }) => {
  await fakeSessions(page, { sellers: () => list });
  await fakeCompare(page);
  await page.goto("/products/p1/sellers");
  const add = page.getByRole("button", { name: "افزودن به مقایسه" });
  await add.nth(0).click();
  await expect(page.getByRole("link", { name: /مقایسه فروشنده‌ها/ })).toHaveCount(0);
  await add.nth(0).click();
  await add.nth(0).click();
  await expect(page.getByRole("button", { name: "حذف از مقایسه" })).toHaveCount(3);
  // a fourth seller cannot be added
  await expect(add).toBeDisabled();
  expect(await noOverflow(page)).toBe(0);
  await page.getByRole("link", { name: "مقایسه فروشنده‌ها (۳)" }).click();
  await expect(page).toHaveURL(/\/products\/p1\/sellers\/compare\?offer=o1&offer=o2&offer=o3$/);
  await expect(page.getByRole("heading", { name: "مقایسه فروشنده‌ها" })).toBeVisible();
});

test("compare table shows every row, unknown values and next actions at 360 px", async ({ page }) => {
  const seed = {
    ...emptyBrief(),
    origin: { lat: 35.6948, lon: 51.4115 },
    travel_mode: "car",
    visit_window: { date: "2026-10-21", earliest_arrival: "17:00:00", latest_departure: null },
  };
  await fakeSessions(page, {}, { s9: { brief: seed } });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "s9"));
  const requests = await fakeCompare(page);
  await page.goto("/products/p1/sellers/compare?offer=o1&offer=o2&offer=o3");

  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: known.shop_name })).toBeVisible();
  const row = (name: string) => table.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
  await expect(row("قیمت ثبت‌شده")).toContainText("۳٫۵۰۰٫۰۰۰ تومان");
  await expect(row("قیمت ثبت‌شده")).toContainText("۲۲ روز پیش");
  await expect(row("قیمت ثبت‌شده")).toContainText("قیمت: نامشخص");
  await expect(row("آخرین قیمت")).toContainText("هنوز استعلام نشده");
  await expect(row("فاصله و زمان")).toContainText("۴۰ متر، ۱ دقیقه");
  await expect(row("فاصله و زمان")).toContainText("نامشخص");
  await expect(row("باز در زمان رسیدن")).toContainText("باز در ۱۷:۰۱");
  await expect(row("گارانتی")).toContainText("۱۸ ماه");
  await expect(row("پرداخت و اقساط")).toContainText("اسنپ‌پی (حضوری)");
  await expect(row("ارسال سریع")).toContainText("دارد");
  await expect(row("اعتبار قیمت")).toContainText("ثبت‌شده");
  for (const name of ["گارانتی", "پرداخت و اقساط", "ارسال سریع", "باز در زمان رسیدن"]) {
    await expect(row(name)).toContainText("نامشخص");
  }
  await expect(page.getByText("زمان رسیدن با فرض خط مستقیم و خودرو تخمین زده شده است.")).toBeVisible();

  await expect(page.getByRole("button", { name: "استعلام از ۳ فروشنده" })).toBeVisible();
  await expect(page.getByRole("link", { name: "دیدن فروشگاه" }).first()).toHaveAttribute("href", "/shops/shop_a");
  expect(await noOverflow(page)).toBe(0);

  // the brief sets the origin, travel mode and visit time
  const q = requests.at(-1)!;
  expect(q.getAll("offer_id")).toEqual(["o1", "o2", "o3"]);
  expect([q.get("lat"), q.get("lon"), q.get("mode"), q.get("arrival")]).toEqual(["35.6948", "51.4115", "car", "2026-10-21T17:00:00+03:30"]);
});
