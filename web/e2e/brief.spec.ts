import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

test.use({ geolocation: { latitude: 35.6948, longitude: 51.4115 }, permissions: ["geolocation"] });

const price = {
  trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false,
  last_price_changed_at: null, price_age_days: null, price_age_bucket: null,
};
const product = { product_id: "p1", title: "کالای الف", brand: null, category: null, image_url: null, key_specs: [], offer_count: 2, price, price_flags: [], score_parts: [], meaning_match: false };
const cards = { block: "product_cards", query: "x", items: [product] };
const row = {
  offer_id: "o1", shop_id: "shop_a", shop_name: "دیسیلا مانسا", area: "شیخ هادی", pasaj: null, floor: null, unit: null,
  lat: null, lon: null, distance_m: null, price_toman: 1000000, per_meter: false, price_age_days: 3, price_age_bucket: "<=7",
  trust_level: "listed", warranty: null, declared_hours: true, open_now: true, payment_options: [], reasons: [],
  latest_price: null, inquiry: null, unknown: [],
};
const sellers = (brief: Record<string, unknown>) => ({
  product_id: "p1",
  title: "کالای الف",
  count: brief.area ? 1 : 2,
  sellers: [row],
  ask_them: [],
  category_only: [],
  nearest_covered: null,
  areas: [],
  pasajs: [],
});

const sheet = (page: Page) => page.getByRole("region", { name: "دستیار" });
const bar = (page: Page) => page.getByRole("region", { name: "خلاصه خرید" });
const chip = (page: Page, name: string) => bar(page).getByRole("button", { name: new RegExp(`^${name}`) });
const drawer = (page: Page, name: string) => page.getByRole("dialog", { name });
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const border = (page: Page, name: string) =>
  chip(page, name).evaluate((el) => [getComputedStyle(el).borderTopWidth, getComputedStyle(el).borderTopColor, getComputedStyle(el).boxShadow.match(/rgb\([^)]*\) [\d.px ]+$/)?.[0] ?? "none"]);
// 1.5px of ink: a 1px border plus a 0.5px ring
const INK = ["1px", "rgb(30, 41, 59)", "rgb(30, 41, 59) 0px 0px 0px 0.5px"];
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const today = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function sellersPage(page: Page) {
  const { patches } = await fakeSessions(page, { sellers });
  await page.goto("/products/p1/sellers");
  await expect(page.getByText("۲ فروشنده")).toBeVisible();
  return patches;
}

test("open now sends today's date and the current time as the arrival at 360 px", async ({ page }) => {
  const patches = await sellersPage(page);
  const before = new Date();
  await chip(page, "الان باز").click();
  await expect.poll(() => patches.at(-1)?.brief?.visit_window).toBeTruthy();
  const after = new Date();
  const v = patches.at(-1)!.brief!.visit_window as { date: string; earliest_arrival: string };
  expect(v.date).toBe(today(before));
  expect([hhmm(before), hhmm(after)]).toContain(v.earliest_arrival);
  await expect(chip(page, "الان باز")).toHaveAttribute("aria-pressed", "true");

  // a second tap clears it
  await chip(page, "الان باز").click();
  await expect.poll(() => patches.at(-1)?.brief?.visit_window).toEqual({ date: null, earliest_arrival: null, latest_departure: null });
  await expect(chip(page, "الان باز")).toHaveAttribute("aria-pressed", "false");
  expect(await noOverflow(page)).toBe(0);
});

test("payment and warranty chips patch the brief and pressed chips get a 1.5px ink border", async ({ page }) => {
  const patches = await sellersPage(page);
  expect(await border(page, "ترب‌پی حضوری")).toEqual(["1px", "rgb(203, 213, 225)", "none"]);

  await chip(page, "ترب‌پی حضوری").click();
  await expect.poll(() => patches.at(-1)).toEqual({ brief: { payment: { kind: "torob_pay", provider: null } } });
  await expect(chip(page, "ترب‌پی حضوری")).toHaveAttribute("aria-pressed", "true");
  expect(await border(page, "ترب‌پی حضوری")).toEqual(INK);

  await chip(page, "اقساطی").click();
  await expect.poll(() => patches.at(-1)).toEqual({ brief: { payment: { kind: "installment", provider: null } } });
  await expect(chip(page, "ترب‌پی حضوری")).toHaveAttribute("aria-pressed", "false");
  await expect(chip(page, "اقساطی")).toHaveAttribute("aria-pressed", "true");

  await chip(page, "گارانتی").click();
  await expect.poll(() => patches.at(-1)).toEqual({ brief: { must_have: { warranty: true, test_in_presence: false, fast_delivery: false } } });
  await expect(chip(page, "گارانتی")).toHaveAttribute("aria-pressed", "true");
  expect(await border(page, "گارانتی")).toEqual(INK);
  expect(await noOverflow(page)).toBe(0);
});

test("area and budget open a bottom drawer; a preset closes it and the chip shows the value", async ({ page }) => {
  const patches = await sellersPage(page);

  await chip(page, "محدوده").click();
  await drawer(page, "محدوده").getByRole("button", { name: "فردوسی", exact: true }).click();
  await expect(drawer(page, "محدوده")).toBeHidden();
  await expect(page.getByText("۱ فروشنده")).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("فردوسی");
  expect(await border(page, "محدوده")).toEqual(INK);
  expect(patches.at(-1)).toEqual({ brief: { area: { name: "فردوسی" } } });

  await chip(page, "محدوده").click();
  await drawer(page, "محدوده").getByRole("button", { name: "نزدیک من، ۱ کیلومتر" }).click();
  await expect(drawer(page, "محدوده")).toBeHidden();
  await expect.poll(() => patches.at(-1)?.brief?.area).toEqual({ radius_m: 1000 });
  expect(patches.at(-1)?.brief?.origin).toEqual({ lat: 35.6948, lon: 51.4115 });
  await expect(chip(page, "محدوده")).toContainText("نزدیک من، ۱ کیلومتر");

  await chip(page, "بودجه").click();
  await drawer(page, "بودجه").getByRole("button", { name: "۵ میلیون" }).click();
  await expect(drawer(page, "بودجه")).toBeHidden();
  await expect(chip(page, "بودجه")).toContainText("تا ۵٫۰۰۰٫۰۰۰ تومان");
  expect(patches.at(-1)?.brief?.budget).toEqual({ max_total_toman: 5000000, max_per_item_toman: null });

  await chip(page, "بودجه").click();
  await page.getByLabel("سقف بودجه به تومان").fill("2000000");
  await page.getByRole("button", { name: "اعمال بودجه" }).click();
  await expect(drawer(page, "بودجه")).toBeHidden();
  await expect(chip(page, "بودجه")).toContainText("تا ۲٫۰۰۰٫۰۰۰ تومان");
  expect(await noOverflow(page)).toBe(0);
});

test("the filters chip counts active filters and its sheet edits the rest, with no rating", async ({ page }) => {
  const patches = await sellersPage(page);
  await expect(chip(page, "فیلترها")).not.toContainText(/[۰-۹]/);
  await chip(page, "گارانتی").click();
  await chip(page, "اقساطی").click();
  await expect(chip(page, "فیلترها")).toContainText("۲");

  await chip(page, "فیلترها").click();
  const all = drawer(page, "فیلترها");
  await all.getByLabel("ساعت رسیدن").fill("17:00");
  await expect.poll(() => (patches.at(-1)?.brief?.visit_window as { earliest_arrival: string } | undefined)?.earliest_arrival).toBe("17:00");
  await all.getByRole("button", { name: "مترو و اتوبوس" }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ brief: { travel_mode: "transit" } });
  await all.getByRole("button", { name: "اسنپ‌پی", exact: true }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ brief: { payment: { kind: "installment", provider: "اسنپ‌پی" } } });
  await all.getByRole("button", { name: "تست در حضور مشتری" }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ brief: { must_have: { warranty: true, test_in_presence: true, fast_delivery: false } } });
  await all.getByRole("button", { name: "معتبرترین" }).click();
  await expect.poll(() => patches.at(-1)).toEqual({ brief: { priority: "most_reliable" } });
  await expect(all).toBeVisible();
  await expect(page.getByText(/امتیاز|ستاره/)).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(all).toBeHidden();
  // payment, warranty, test in presence, visit time
  await expect(chip(page, "فیلترها")).toContainText("۴");
});

test("the chip row scrolls inside itself and the first seller row sits in the top 60% at 360x740", async ({ page }) => {
  await sellersPage(page);
  expect(await noOverflow(page)).toBe(0);
  const row = bar(page).locator("[data-chip-row]");
  expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const box = await page.getByRole("main").getByRole("listitem").first().boundingBox();
  expect(box!.y).toBeLessThan(740 * 0.6);
});

test("the chip bar is not on routes that do not filter", async ({ page }) => {
  await fakeSessions(page, { sellers });
  await page.route("**/api/shops/**", (route) => route.fulfill({ status: 404, json: { detail: "not found" } }));
  await page.goto("/shops/shop_a");
  await expect(bar(page)).toHaveCount(0);
});

test("a product link opens its sellers with the brief kept, and back keeps it too", async ({ page }) => {
  const { patches } = await fakeSessions(page, { sellers });
  await fakeAgent(page, [cards]);
  await page.goto("/");
  await chip(page, "محدوده").click();
  await drawer(page, "محدوده").getByRole("button", { name: "فردوسی", exact: true }).click();
  await askHome(page, "x");
  await sheet(page).getByRole("link", { name: "دیدن فروشنده‌ها" }).click();

  await expect(page).toHaveURL(/\/products\/p1\/sellers$/);
  await expect(page.getByText("۱ فروشنده")).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("فردوسی");
  expect(patches.at(-1)).toEqual({ step: { kind: "sellers", product_id: "p1" } });

  await page.goBack();
  // the link closed the sheet; the thread is still there
  await sheet(page).getByRole("button", { name: "گفتگو" }).click();
  await expect(sheet(page).getByRole("link", { name: "دیدن فروشنده‌ها" })).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("فردوسی");
});

test("a shared product link opens straight into its sellers", async ({ page }) => {
  await fakeSessions(page, { sellers });
  await page.goto("/products/p1/sellers");
  await expect(page.getByRole("heading", { name: "کالای الف" })).toBeVisible();
  await expect(bar(page)).toBeVisible();
});

test("home offers examples, a near-me chip and recent sessions", async ({ page }) => {
  const thread = [
    { id: "u1", role: "user", content: "شارژر اپل" },
    { id: "a1", role: "assistant", content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "search_products", arguments: "{}" } }] },
    { id: "t1", role: "tool", toolCallId: "c1", content: JSON.stringify(cards) },
  ];
  const { patches } = await fakeSessions(page, { sellers }, {
    old1: { brief: { need: "شارژر اپل" }, step: { kind: "search" }, messages: thread },
    old2: { step: { kind: "sellers", product_id: "p1", title: "کالای الف" } },
  });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.sessions", JSON.stringify(["old1", "old2"])));
  await page.goto("/");

  await expect(page.getByRole("button", { name: "یه هندزفری بلوتوثی برای باشگاه میخوام، حوالی جمهوری، ساعت ۵ عصر، قسطی" })).toBeVisible();
  const recent = page.getByRole("region", { name: "جلسه‌های اخیر" });
  await expect(recent.getByRole("button", { name: "شارژر اپل" })).toBeVisible();
  await expect(recent.getByRole("button", { name: "کالای الف" })).toBeVisible();
  expect(await noOverflow(page)).toBe(0);

  await page.getByRole("button", { name: "نزدیک من", exact: true }).click();
  await expect.poll(() => patches.at(-1)?.brief?.area).toEqual({ radius_m: 1000 });
  expect(patches.at(-1)?.brief?.origin).toEqual({ lat: 35.6948, lon: 51.4115 });
  await expect(chip(page, "محدوده")).toContainText("نزدیک من");

  await recent.getByRole("button", { name: "کالای الف" }).click();
  await expect(page).toHaveURL(/\/products\/p1\/sellers$/);

  await page.goto("/");
  await page.getByRole("region", { name: "جلسه‌های اخیر" }).getByRole("button", { name: "شارژر اپل" }).click();
  // the resumed session opens its own thread
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
  await expect(sheet(page).getByRole("link", { name: "دیدن فروشنده‌ها" })).toBeVisible();
});

test.describe("without geolocation", () => {
  test.use({ permissions: [] });

  test("a covered pasaj can be the radius origin instead of the user's position at 360 px", async ({ page }) => {
    const { patches } = await fakeSessions(page, { sellers });
    await page.goto("/products/p1/sellers");
    await chip(page, "محدوده").click();
    const area = drawer(page, "محدوده");
    await area.getByRole("button", { name: "مرکز: پاساژ علاالدین" }).click();
    await expect.poll(() => patches.at(-1)).toEqual({ brief: { origin: { lat: 35.6949, lon: 51.4113 } } });

    await area.getByRole("button", { name: "۱ کیلومتر از پاساژ علاالدین" }).click();
    await expect.poll(() => patches.at(-1)).toEqual({ brief: { area: { radius_m: 1000 } } });
    await expect(chip(page, "محدوده")).toContainText("۱ کیلومتر از پاساژ علاالدین");
    await expect(page.getByText("۱ فروشنده")).toBeVisible();
    expect(await noOverflow(page)).toBe(0);
  });
});
