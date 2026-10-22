import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

test.use({ geolocation: { latitude: 35.6948, longitude: 51.4115 }, permissions: ["geolocation"] });

const price = {
  trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false,
  last_price_changed_at: null, price_age_days: null, price_age_bucket: null,
};
const product = { product_id: "p1", title: "کالای الف", brand: null, category: null, image_url: null, key_specs: [], offer_count: 2, price, price_flags: [], score_parts: [], meaning_match: false };
const cards = { block: "product_cards", query: "x", items: [product] };
const sellers = (brief: Record<string, unknown>) => ({
  product_id: "p1",
  title: "کالای الف",
  count: brief.area ? 1 : 2,
  sellers: [],
  ask_them: [],
  category_only: [],
  nearest_covered: null,
  areas: [],
  pasajs: [],
});

const sheet = (page: Page) => page.getByRole("region", { name: "دستیار" });
const bar = (page: Page) => page.getByRole("region", { name: "خلاصه خرید" });
const chip = (page: Page, name: string) => bar(page).getByRole("button", { name: new RegExp(`^${name}`) });
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("brief bar chips edit every field in place and re-run results at 360 px", async ({ page }) => {
  const { patches } = await fakeSessions(page, { sellers });
  await page.goto("/products/p1/sellers");
  await expect(page.getByText("۲ فروشنده")).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("همه مناطق");
  expect(await noOverflow(page)).toBe(0);

  await chip(page, "محدوده").click();
  await page.getByLabel("انتخاب محدوده").selectOption({ label: "فردوسی" });
  await expect(page.getByText("۱ فروشنده")).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("فردوسی");
  expect(patches.at(-1)).toEqual({ brief: { area: { name: "فردوسی" } } });

  await chip(page, "بودجه").click();
  await page.getByLabel("سقف بودجه به تومان").fill("2000000");
  await page.getByRole("button", { name: "اعمال بودجه" }).click();
  await expect(chip(page, "بودجه")).toContainText("تا ۲٫۰۰۰٫۰۰۰ تومان");
  expect(patches.at(-1)?.brief?.budget).toEqual({ max_total_toman: 2000000, max_per_item_toman: null });

  await chip(page, "زمان مراجعه").click();
  await page.getByLabel("ساعت رسیدن").fill("17:00");
  await expect(chip(page, "زمان مراجعه")).toContainText("۱۷:۰۰");
  expect((patches.at(-1)?.brief?.visit_window as { earliest_arrival: string }).earliest_arrival).toBe("17:00");

  await chip(page, "نحوه رفتن").click();
  await page.getByRole("button", { name: "مترو و اتوبوس" }).click();
  await expect(chip(page, "نحوه رفتن")).toContainText("مترو و اتوبوس");
  expect(patches.at(-1)).toEqual({ brief: { travel_mode: "transit" } });

  await chip(page, "پرداخت").click();
  await page.getByRole("button", { name: "اقساطی" }).click();
  await expect(chip(page, "پرداخت")).toContainText("اقساطی");
  expect(patches.at(-1)).toEqual({ brief: { payment: { kind: "installment", provider: null } } });
  await bar(page).getByRole("button", { name: "اسنپ‌پی", exact: true }).click();
  await expect(chip(page, "پرداخت")).toContainText("اقساطی اسنپ‌پی");
  expect(patches.at(-1)).toEqual({ brief: { payment: { kind: "installment", provider: "اسنپ‌پی" } } });

  await chip(page, "شرایط").click();
  await bar(page).getByRole("button", { name: "گارانتی", exact: true }).click();
  await expect(chip(page, "شرایط")).toContainText("گارانتی");
  expect(patches.at(-1)).toEqual({ brief: { must_have: { warranty: true, test_in_presence: false, fast_delivery: false } } });
  await expect(bar(page).getByRole("button", { name: "گارانتی", exact: true })).toHaveAttribute("aria-pressed", "true");

  await chip(page, "اولویت").click();
  await page.getByRole("button", { name: "معتبرترین" }).click();
  await expect(chip(page, "اولویت")).toContainText("معتبرترین");
  expect(patches.at(-1)).toEqual({ brief: { priority: "most_reliable" } });
  expect(await noOverflow(page)).toBe(0);
});

test("a product link opens its sellers with the brief kept, and back keeps it too", async ({ page }) => {
  const { patches } = await fakeSessions(page, { sellers });
  await fakeAgent(page, [cards]);
  await page.goto("/");
  await chip(page, "محدوده").click();
  await page.getByLabel("انتخاب محدوده").selectOption({ label: "فردوسی" });
  await askHome(page, "x");
  await sheet(page).getByRole("link", { name: "دیدن فروشنده‌ها" }).click();

  await expect(page).toHaveURL(/\/products\/p1\/sellers$/);
  await expect(page.getByText("۱ فروشنده")).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("فردوسی");
  expect(patches.at(-1)).toEqual({ step: { kind: "sellers", product_id: "p1" } });

  await page.goBack();
  // the link closed the sheet; the thread is still there
  await page.getByRole("button", { name: "دستیار خرید" }).click();
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

  await page.getByRole("button", { name: "نزدیک من" }).click();
  await expect.poll(() => patches.at(-1)?.brief?.area).toEqual({ radius_m: 1000 });
  expect(patches.at(-1)?.brief?.origin).toEqual({ lat: 35.6948, lon: 51.4115 });
  await expect(chip(page, "محدوده")).toContainText("نزدیک من");

  await recent.getByRole("button", { name: "کالای الف" }).click();
  await expect(page).toHaveURL(/\/products\/p1\/sellers$/);

  await page.goto("/");
  await page.getByRole("region", { name: "جلسه‌های اخیر" }).getByRole("button", { name: "شارژر اپل" }).click();
  // the resumed session has its own thread behind the agent bar
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
  await expect(sheet(page).getByRole("link", { name: "دیدن فروشنده‌ها" })).toBeVisible();
});

test.describe("without geolocation", () => {
  test.use({ permissions: [] });

  test("a covered pasaj can be the radius origin instead of the user's position at 360 px", async ({ page }) => {
    const { patches } = await fakeSessions(page, { sellers });
    await page.goto("/products/p1/sellers");
    await chip(page, "محدوده").click();
    await page.getByLabel("مرکز شعاع").selectOption({ label: "مرکز شعاع: پاساژ علاالدین" });
    await expect.poll(() => patches.at(-1)).toEqual({ brief: { origin: { lat: 35.6949, lon: 51.4113 } } });

    await page.getByLabel("انتخاب محدوده").selectOption({ label: "۱ کیلومتر از پاساژ علاالدین" });
    await expect.poll(() => patches.at(-1)).toEqual({ brief: { area: { radius_m: 1000 } } });
    await expect(chip(page, "محدوده")).toContainText("۱ کیلومتر از پاساژ علاالدین");
    await expect(page.getByText("۱ فروشنده")).toBeVisible();
    expect(await noOverflow(page)).toBe(0);
  });
});
