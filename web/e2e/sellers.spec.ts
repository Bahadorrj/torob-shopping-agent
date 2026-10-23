import { expect, test, type Locator, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

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
  open_now: true,
  payment_options: [],
  unknown: [],
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
  ask_them: [],
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

type Area = { radius_m: number | null; name: string | null; pasaj: string | null } | null;

async function open(page: Page, respond: (brief: Record<string, unknown>) => object) {
  const { patches } = await fakeSessions(page, { sellers: respond });
  await page.goto("/products/p1/sellers");
  await expect(page.getByRole("heading", { name: list.title })).toBeVisible();
  return patches;
}

const area = (brief: Record<string, unknown>) => brief.area as Area;
const bar = (page: Page) => page.getByRole("region", { name: "خلاصه خرید" });

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// buttons and links with a fill of their own, not ghost (transparent) or white
const filled = (loc: Locator) =>
  loc.locator("button, a").evaluateAll((els) =>
    els.filter((e) => !["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"].includes(getComputedStyle(e).backgroundColor)).length,
  );

test("result cards show price, age and availability slots, one reason and one filled action at 360 px", async ({ page }) => {
  const today = new Date().toLocaleDateString("en-CA");
  const confirmed = {
    ...row,
    offer_id: "o3",
    shop_id: "shop_e",
    shop_name: "مانا نیلا",
    price_toman: 3800000,
    reasons: [{ kind: "closest", months: null }],
    latest_price: { status: "confirmed", price_toman: 3750000, trust_level: "confirmed", at: `${today}T11:42:00+03:30` },
    inquiry: { inquiry_id: 1, status: "replied", available: "yes", latest_price_toman: 3750000, hold_until: null, installments: null, replied_at: `${today}T11:42:00+03:30` },
  };
  const waiting = { ...unpriced, inquiry: { ...confirmed.inquiry, status: "sent", available: "unknown", latest_price_toman: null, replied_at: null } };
  await open(page, () => ({ ...list, count: 3, sellers: [row, confirmed, waiting] }));
  await expect(page.getByText("۳ فروشنده", { exact: true })).toBeVisible();
  const card = (name: string) => page.getByRole("listitem").filter({ hasText: name });
  const slot = (name: string, s: string) => card(name).locator(`[data-slot="${s}"]`);

  for (const name of [row.shop_name, confirmed.shop_name, unpriced.shop_name]) {
    for (const s of ["price", "age", "availability"]) await expect(slot(name, s)).toHaveCount(1);
    await expect(slot(name, "age")).toContainText("آخرین تغییر قیمت");
    await expect(slot(name, "age")).not.toContainText("به‌روز");
    await expect(slot(name, "availability")).toContainText("موجودی");
    await expect(card(name).locator('[data-slot="badge"]')).toHaveCount(1);
    expect(await filled(card(name))).toBe(1);
  }

  await expect(slot(row.shop_name, "price")).toContainText("۳٫۵۰۰٫۰۰۰ تومان");
  await expect(slot(row.shop_name, "price")).toContainText("قیمت ثبت‌شده");
  await expect(slot(row.shop_name, "age")).toContainText("۲۲ روز پیش");
  await expect(slot(row.shop_name, "availability")).toContainText("نامشخص");
  await expect(card(row.shop_name).locator('[data-slot="badge"]')).toHaveText("ارزان‌ترین");
  await expect(card(row.shop_name).getByRole("button", { name: "استعلام بگیرید" })).toBeVisible();
  await expect(card(row.shop_name).getByRole("link", { name: row.shop_name })).toHaveAttribute("href", "/shops/shop_a");

  await expect(slot(confirmed.shop_name, "price")).toContainText("۳٫۷۵۰٫۰۰۰ تومان");
  await expect(slot(confirmed.shop_name, "price")).toContainText("قیمت فروشنده، ساعت ۱۱:۴۲");
  await expect(slot(confirmed.shop_name, "age")).toContainText("امروز");
  await expect(slot(confirmed.shop_name, "availability")).toContainText("موجود است");
  await expect(card(confirmed.shop_name)).toContainText("قیمت ثبت‌شده ۳٫۸۰۰٫۰۰۰ تومان بود.");
  await expect(card(confirmed.shop_name).getByRole("button", { name: "مسیر تا فروشگاه" })).toBeVisible();

  await expect(slot(unpriced.shop_name, "price")).toHaveText("قیمت: نامشخص");
  await expect(slot(unpriced.shop_name, "availability")).toContainText("در انتظار پاسخ");
  await expect(card(unpriced.shop_name).getByRole("button", { name: "استعلام فرستاده شد" })).toBeDisabled();

  // the dock is the page's one red button
  await expect(page.locator(".bg-brand")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "استعلام از ۱ فروشنده ارزان‌تر" })).toBeVisible();
  expect(await noOverflow(page)).toBe(0);
});

test("seller rows show reason chips, trust badge and link to the shop at 360 px", async ({ page }) => {
  await open(page, () => list);
  await expect(page.getByText("۲ فروشنده", { exact: true })).toBeVisible();
  const first = page.getByRole("listitem").filter({ hasText: row.shop_name });
  await expect(first).toContainText("ارزان‌ترین");
  await expect(first).toContainText("قیمت ثبت‌شده");
  await expect(first).toContainText("۳٫۵۰۰٫۰۰۰ تومان");
  await expect(page.getByRole("listitem").filter({ hasText: unpriced.shop_name })).toContainText("قیمت: نامشخص");

  const categoryOnly = page.getByRole("region", { name: "فروشگاه‌های هم‌دسته" });
  await expect(categoryOnly).toContainText("رامیلا رامیرا");
  await expect(categoryOnly).toContainText("فقط دسته فعالیت - موجودی نامشخص");
  expect(await noOverflow(page)).toBe(0);
});

test("area and ranking changes in the brief bar refetch the list and update the count", async ({ page }) => {
  const patches = await open(page, (b) => (area(b)?.name ? { ...list, count: 1, sellers: [unpriced] } : list));
  await bar(page).getByRole("button", { name: /^محدوده/ }).click();
  await page.getByRole("dialog", { name: "محدوده" }).getByRole("button", { name: "فردوسی", exact: true }).click();
  await expect(page.getByText("۱ فروشنده", { exact: true })).toBeVisible();
  expect(patches.at(-1)?.brief?.area).toEqual({ name: "فردوسی" });

  await bar(page).getByRole("button", { name: /^محدوده/ }).click();
  await page.getByRole("dialog", { name: "محدوده" }).getByRole("button", { name: "پاساژ علاالدین", exact: true }).click();
  await expect.poll(() => patches.at(-1)?.brief?.area).toEqual({ pasaj: "علاالدین" });

  await bar(page).getByRole("button", { name: /^محدوده/ }).click();
  await page.getByRole("dialog", { name: "محدوده" }).getByRole("button", { name: "نزدیک من، ۱ کیلومتر", exact: true }).click();
  await expect.poll(() => patches.at(-1)?.brief?.area).toEqual({ radius_m: 1000 });
  expect(patches.at(-1)?.brief?.origin).toEqual({ lat: 35.6948, lon: 51.4115 });

  await bar(page).getByRole("button", { name: /^فیلترها/ }).click();
  await page.getByRole("dialog", { name: "فیلترها" }).getByRole("button", { name: "معتبرترین" }).click();
  await expect.poll(() => patches.at(-1)?.brief?.priority).toBe("most_reliable");
  await expect(page.getByRole("button", { name: "معتبرترین", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("one seller looks fine", async ({ page }) => {
  await open(page, () => ({ ...list, count: 1, sellers: [{ ...row, reasons: [] }], category_only: [] }));
  await expect(page.getByText("۱ فروشنده", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "فروشگاه‌های هم‌دسته" })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(0);
});

test("an empty area explains coverage and suggests the nearest covered area", async ({ page }) => {
  const patches = await open(page, (b) => (area(b)?.name === "بهارستان" ? list : empty));
  await expect(page.getByText("داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند")).toBeVisible();
  await page.getByRole("button", { name: /بهارستان/ }).click();
  await expect(page.getByText("۲ فروشنده", { exact: true })).toBeVisible();
  expect(patches.at(-1)?.brief?.area).toEqual({ name: "بهارستان" });
  expect(await noOverflow(page)).toBe(0);
});

test("condition chips, the declared installment channel and the ask-them group at 360 px", async ({ page }) => {
  const installments = {
    ...row,
    payment_options: [{ provider: "اسنپ‌پی", channel: "in_person" }, { provider: "تارا", channel: "unknown" }],
    reasons: [{ kind: "open_now", months: null, provider: null }, { kind: "installments", months: null, provider: "اسنپ‌پی" }],
  };
  await open(page, () => ({ ...list, count: 1, sellers: [installments], ask_them: [{ ...unpriced, unknown: ["hours", "payment"] }] }));
  const first = page.getByRole("listitem").filter({ hasText: row.shop_name });
  await expect(first.locator('[data-slot="badge"]')).toHaveText("الان باز");
  await expect(first).toContainText("اسنپ‌پی حضوری، تارا · الان باز");

  const ask = page.getByRole("region", { name: "از فروشنده بپرسید" });
  await expect(ask).toContainText(unpriced.shop_name);
  await expect(ask).toContainText("نامشخص: ساعت کاری، روش پرداخت");
  expect(await noOverflow(page)).toBe(0);
});

test("filters that leave no seller say so instead of suggesting another area", async ({ page }) => {
  await open(page, () => ({ ...list, count: 0, sellers: [], category_only: [], nearest_covered: null }));
  await expect(page.getByText("فروشنده‌ای با همه شرایط شما پیدا نشد")).toBeVisible();
  await expect(page.getByText("این محدوده پوشش داده نشده")).toHaveCount(0);
});

test("product card links to its sellers", async ({ page }) => {
  const price = {
    trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false,
    last_price_changed_at: null, price_age_days: null, price_age_bucket: null,
  };
  await fakeSessions(page, {});
  await fakeAgent(page, [{
    block: "product_cards",
    query: "x",
    items: [{ product_id: "p1", title: "کالای الف", brand: null, category: null, image_url: null, key_specs: [], offer_count: 2, price, price_flags: [], score_parts: [], meaning_match: false }],
  }]);
  await page.goto("/");
  await askHome(page, "x");
  await expect(page.getByRole("link", { name: "دیدن فروشنده‌ها" })).toHaveAttribute("href", "/products/p1/sellers");
});

test("seller cards end with ask, directions and compare, in both groups, at 360 px", async ({ page }) => {
  const askThem = { ...unpriced, unknown: ["hours"] };
  // R50i NC in شیخ هادی: no seller meets every condition, two are in the ask-them group
  const r50 = { ...list, count: 0, sellers: [], ask_them: [row, askThem] };
  await fakeSessions(page, { sellers: () => r50 }, { s9: { brief: { origin: { lat: 35.69, lon: 51.41 }, travel_mode: "walk" } } });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "s9"));
  const composed: string[][] = [];
  const drafts: object[] = [];
  await page.route("**/api/sessions/*/inquiries**", (route) => {
    const req = route.request();
    if (new URL(req.url()).pathname.endsWith("/stream"))
      return route.fulfill({ contentType: "text/event-stream", body: `retry: 100\ndata: ${JSON.stringify({ inquiries: drafts })}\n\n` });
    const offers: string[] = req.postDataJSON().offer_ids;
    composed.push(offers);
    drafts.push({
      inquiry_id: 1, offer_id: "o1", product_id: "p1", product_title: list.title, shop_id: "shop_a", shop_name: row.shop_name,
      status: "draft", message: "سلام، الان موجود است؟", channel: null, simulated: false,
      reply: { available: "unknown", latest_price_toman: null, hold_until: null, installments: null, notes: null, confidence: null },
      events: [{ at: "2026-10-21T12:00:00+03:30", status: "draft", reply: null, question: null }],
    });
    return route.fulfill({ status: 201, json: { inquiries: drafts } });
  });
  const routed: URLSearchParams[] = [];
  await page.route("**/api/shops/*/directions**", (route) => {
    const url = new URL(route.request().url());
    routed.push(url.searchParams);
    const shop_id = url.pathname.split("/")[3];
    return route.fulfill({
      json: {
        shop_id, shop_name: "x", lat: 35.69, lon: 51.41,
        route: { distance_m: 400, duration_min: 6, source: "straight_line" },
        links: { neshan: "https://nshn.ir/?x", balad: "https://balad.ir/location?x", google: "https://www.google.com/maps/dir/?x" },
        last_leg: { pasaj: "علاالدین 2", landmark: null, floor: "۳", unit: "۳۲۷" },
      },
    });
  });
  await page.goto("/products/p1/sellers");

  // the count covers the ask-them group
  await expect(page.getByText("۲ فروشنده", { exact: true })).toBeVisible();
  const ask = page.getByRole("region", { name: "از فروشنده بپرسید" });
  const card = ask.getByRole("listitem").filter({ hasText: row.shop_name });
  // the shop name looks like a link without hover
  const name = card.getByRole("link", { name: row.shop_name });
  await expect(name).toHaveAttribute("href", "/shops/shop_a");
  await expect(card.getByRole("button", { name: "مقایسه", exact: true })).toBeVisible();

  await card.getByRole("button", { name: "استعلام بگیرید" }).click();
  await expect(page.getByRole("heading", { name: "پیش‌نویس پیام‌ها" })).toBeVisible();
  expect(composed).toEqual([["o1"]]);
  await expect(card.getByRole("button", { name: "پیش‌نویس استعلام آماده است" })).toBeDisabled();

  await card.getByRole("button", { name: "مسیر", exact: true }).click();
  await expect(card.getByRole("link", { name: "باز کردن در نشان" })).toBeVisible();
  await expect(card).toContainText("۶ دقیقه (تخمین خط مستقیم)");
  expect(routed[0].get("lat")).toBe("35.69");
  expect(routed[0].get("mode")).toBe("walk");

  // category-only shops get the shop page and directions, nothing to ask or compare
  const categoryOnly = page.getByRole("region", { name: "فروشگاه‌های هم‌دسته" }).getByRole("listitem");
  await expect(categoryOnly.getByRole("link", { name: "رامیلا رامیرا" })).toHaveAttribute("href", "/shops/shop_c");
  await expect(categoryOnly.getByRole("button", { name: "استعلام بگیرید" })).toHaveCount(0);
  await categoryOnly.getByRole("button", { name: "مسیر" }).click();
  await expect(categoryOnly.getByRole("link", { name: "باز کردن در گوگل مپ" })).toBeVisible();
  expect(await noOverflow(page)).toBe(0);
});

test("directions without an origin ask for one", async ({ page }) => {
  await open(page, () => list);
  const card = page.getByRole("listitem").filter({ hasText: row.shop_name });
  await card.getByRole("button", { name: "مسیر", exact: true }).click();
  await expect(card).toContainText("برای مسیر، مبدأ را در خلاصه خرید انتخاب کنید.");
});

test("a long same-category list shows 10 shops and a button for the rest at 360 px", async ({ page }) => {
  const many = Array.from({ length: 14 }, (_, n) => ({ ...list.category_only[0], shop_id: `shop_c${n}`, shop_name: `فروشگاه ${n + 1}` }));
  await open(page, () => ({ ...list, category_only: many }));
  const shops = page.getByRole("region", { name: "فروشگاه‌های هم‌دسته" });
  await expect(shops.getByRole("listitem")).toHaveCount(10);
  await shops.getByRole("button", { name: "نمایش ۴ فروشگاه دیگر" }).click();
  await expect(shops.getByRole("listitem")).toHaveCount(14);
  await expect(shops.getByRole("button", { name: /نمایش/ })).toHaveCount(0);
  const link = (await shops.getByRole("link").first().boundingBox())!;
  expect(link.height).toBeGreaterThanOrEqual(40);
  expect(await noOverflow(page)).toBe(0);
});
