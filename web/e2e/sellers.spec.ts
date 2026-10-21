import { expect, test, type Page } from "@playwright/test";

test.use({ geolocation: { latitude: 35.6948, longitude: 51.4115 }, permissions: ["geolocation"] });

const row = {
  offer_id: "o1",
  shop_id: "shop_a",
  shop_name: "دیسیلا مانسا",
  area: "شیخ هادی",
  pasaj: "علاالدین 2",
  floor: "۳",
  unit: "۳۲۷",
  distance_m: 40,
  price_toman: 3500000,
  per_meter: false,
  price_age_days: 22,
  price_age_bucket: "8-30",
  trust_level: "listed",
  warranty: { kind: "warranty", provider: null, months: 18, description: null },
  declared_hours: true,
  reasons: [
    { kind: "cheapest", months: null },
    { kind: "warranty", months: 18 },
  ],
};

const unpriced = {
  ...row,
  offer_id: "o2",
  shop_id: "shop_b",
  shop_name: "دیسآرا مانوش",
  pasaj: null,
  floor: null,
  unit: null,
  distance_m: 1200,
  price_toman: null,
  price_age_days: null,
  price_age_bucket: null,
  trust_level: "unknown",
  warranty: null,
  reasons: [],
};

const list = {
  product_id: "p1",
  title: "هندزفری انکر R50i",
  count: 2,
  sellers: [row, unpriced],
  category_only: [{ shop_id: "shop_c", shop_name: "رامیلا رامیرا", area: "شیخ هادی", pasaj: null, distance_m: null, trust_level: "category_only" }],
  nearest_covered: null,
  areas: ["بهارستان", "شیخ هادی", "فردوسی"],
  pasajs: ["علاالدین"],
};

const empty = {
  ...list,
  count: 0,
  sellers: [],
  category_only: [],
  nearest_covered: { area: "بهارستان", pasaj: "صدقی نژاد", distance_m: 390 },
};

async function open(page: Page, respond: (params: URLSearchParams) => object) {
  const requests: URLSearchParams[] = [];
  await page.route("**/api/products/p1/sellers*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return route.fulfill({ json: respond(params) });
  });
  await page.goto("/products/p1/sellers");
  await expect(page.getByRole("heading", { name: list.title })).toBeVisible();
  return requests;
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("seller rows show reason chips, trust badge and link to the shop at 360 px", async ({ page }) => {
  await open(page, () => list);
  await expect(page.getByText("۲ فروشنده")).toBeVisible();
  const first = page.getByRole("listitem").filter({ hasText: row.shop_name });
  await expect(first).toContainText("ارزان‌ترین");
  await expect(first).toContainText("گارانتی ۱۸ ماهه");
  await expect(first).toContainText("قیمت ثبت‌شده");
  await expect(first).toContainText("۳٬۵۰۰٬۰۰۰ تومان");
  await expect(first.getByRole("link", { name: row.shop_name })).toHaveAttribute("href", "/shops/shop_a");
  await expect(page.getByRole("listitem").filter({ hasText: unpriced.shop_name })).toContainText("قیمت ثبت نشده");

  const categoryOnly = page.getByRole("region", { name: "فروشگاه‌های هم‌دسته" });
  await expect(categoryOnly).toContainText("رامیلا رامیرا");
  await expect(categoryOnly).toContainText("فقط دسته فعالیت - موجودی نامشخص");
  expect(await noOverflow(page)).toBe(0);
});

test("area and ranking changes refetch the list and update the count", async ({ page }) => {
  const requests = await open(page, (p) => (p.get("area") ? { ...list, count: 1, sellers: [unpriced] } : list));
  await page.getByLabel("محدوده").selectOption({ label: "فردوسی" });
  await expect(page.getByText("۱ فروشنده")).toBeVisible();
  expect(requests.at(-1)?.get("area")).toBe("فردوسی");

  await page.getByLabel("محدوده").selectOption({ label: "پاساژ علاالدین" });
  await expect.poll(() => requests.at(-1)?.get("pasaj")).toBe("علاالدین");

  await page.getByLabel("محدوده").selectOption({ label: "نزدیک من، ۱ کیلومتر" });
  await expect.poll(() => requests.at(-1)?.get("radius_m")).toBe("1000");
  expect(requests.at(-1)?.get("lat")).toBe("35.6948");

  await page.getByRole("button", { name: "معتبرترین" }).click();
  await expect.poll(() => requests.at(-1)?.get("priority")).toBe("most_reliable");
  await expect(page.getByRole("button", { name: "معتبرترین" })).toHaveAttribute("aria-pressed", "true");
});

test("one seller looks fine", async ({ page }) => {
  await open(page, () => ({ ...list, count: 1, sellers: [{ ...row, reasons: [] }], category_only: [] }));
  await expect(page.getByText("۱ فروشنده")).toBeVisible();
  await expect(page.getByRole("region", { name: "فروشگاه‌های هم‌دسته" })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(0);
});

test("an empty area explains coverage and suggests the nearest covered area", async ({ page }) => {
  const requests = await open(page, (p) => (p.get("area") === "بهارستان" ? list : empty));
  await expect(page.getByText("داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند")).toBeVisible();
  await page.getByRole("button", { name: /بهارستان/ }).click();
  await expect(page.getByText("۲ فروشنده")).toBeVisible();
  expect(requests.at(-1)?.get("area")).toBe("بهارستان");
  expect(await noOverflow(page)).toBe(0);
});

test("product card links to its sellers", async ({ page }) => {
  const price = {
    trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false,
    last_price_changed_at: null, price_age_days: null, price_age_bucket: null,
  };
  await page.route("**/api/products/search?*", (route) =>
    route.fulfill({
      json: {
        query: "x",
        items: [{ product_id: "p1", title: "کالای الف", brand: null, category: null, image_url: null, key_specs: [], offer_count: 2, price, price_flags: [] }],
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("جستجوی کالا").fill("x");
  await page.getByRole("button", { name: "جستجو" }).click();
  await expect(page.getByRole("link", { name: "دیدن فروشنده‌ها" })).toHaveAttribute("href", "/products/p1/sellers");
});
