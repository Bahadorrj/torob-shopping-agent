import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const price = {
  trust_level: "listed", min_toman: 1000000, max_toman: 2000000, per_meter: false,
  last_price_changed_at: null, price_age_days: 13, price_age_bucket: "8-30",
};
const unknownPrice = { ...price, trust_level: "unknown", min_toman: null, max_toman: null, price_age_days: null, price_age_bucket: null };
const parts = [
  { word: "هدفون", matched: true },
  { word: "انکر", matched: true },
  { word: "ورزش", matched: false },
];
const card = (id: string, title: string) => ({
  product_id: id, title, brand: null, category: null, image_url: null, key_specs: [], offer_count: 8, price, price_flags: [], score_parts: parts, meaning_match: false,
});
const items = [card("p1", "کالای الف"), card("p2", "کالای ب"), card("p3", "کالای ج"), card("p4", "کالای د")];

const column = (id: string, title: string) => ({
  product_id: id, title, brand: null, image_url: null, price, seller_count: 8,
  warranty: { trust_level: "listed", sellers: 2, max_months: 18 },
});
const compareResult = (brief: Record<string, unknown>, ids: string[]) => ({
  products: ids.map((id, i) =>
    i === 1
      ? { ...column(id, "کالای ب"), price: unknownPrice, seller_count: brief.area ? 0 : 3, warranty: { trust_level: "unknown", sellers: 0, max_months: null } }
      : column(id, items.find((p) => p.product_id === id)!.title),
  ),
  specs: [
    { key: "رنگ", values: ids.map((_, i) => (i === 0 ? "سفید" : "مشکی")), differs: true },
    { key: "وزن", values: ids.map((_, i) => (i === 1 ? null : "60 گرم")), differs: true },
    { key: "نسخه بلوتوث", values: ids.map(() => "5.3"), differs: false },
  ],
});

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function searchAll(page: Page, found = items) {
  await fakeAgent(page, [{ block: "product_cards", query: "هدفون", items: found }]);
  await page.goto("/");
  await askHome(page, "هدفون");
}

const result = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

test("compare tray holds up to three products and opens the compare table at 360 px", async ({ page }) => {
  const { patches } = await fakeSessions(page, { compare: compareResult });
  await searchAll(page);
  for (const t of ["کالای الف", "کالای ب", "کالای ج"]) await result(page, t).getByRole("button", { name: "افزودن به مقایسه" }).click();
  // the fourth cannot join a full tray
  await expect(result(page, "کالای د").getByRole("button", { name: "افزودن به مقایسه" })).toBeDisabled();
  const tray = page.getByRole("region", { name: "سبد مقایسه" });
  await expect(tray).toContainText("۳ از ۳");
  expect(await noOverflow(page)).toBe(0);

  await tray.getByRole("link", { name: "مقایسه" }).click();
  await expect(page).toHaveURL(/\/compare\?ids=p1%2Cp2%2Cp3$/);

  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "کالای الف" })).toBeVisible();
  expect(patches.at(-1)!.step).toEqual({ kind: "compare", product_ids: ["p1", "p2", "p3"] });
  // differing rows are highlighted, a spec a product does not record is unknown, not blank
  await expect(table.getByRole("row", { name: /رنگ/ })).toHaveAttribute("data-differs", "true");
  await expect(table.getByRole("row", { name: /وزن/ })).toContainText("ثبت نشده");
  // identical rows are collapsed behind a toggle
  await expect(table.getByRole("row", { name: /نسخه بلوتوث/ })).toHaveCount(0);
  await page.getByRole("button", { name: "نمایش ۱ ویژگی یکسان" }).click();
  await expect(table.getByRole("row", { name: /نسخه بلوتوث/ })).toBeVisible();

  // nearby price, seller count and warranty, each with its trust level
  await expect(table.getByRole("row", { name: /قیمت در محدوده/ })).toContainText("قیمت ثبت‌شده");
  await expect(table.getByRole("row", { name: /قیمت در محدوده/ })).toContainText("قیمت ثبت نشده");
  await expect(table.getByRole("row", { name: /فروشنده در محدوده/ })).toContainText("۸ فروشنده ثبت‌شده");
  await expect(table.getByRole("row", { name: /گارانتی/ })).toContainText("تا ۱۸ ماه، نزد ۲ فروشنده");
  await expect(table.getByRole("row", { name: /گارانتی/ })).toContainText("ثبت نشده");

  // every column ends with its next action
  const next = table.getByRole("link", { name: "دیدن فروشنده‌ها" });
  await expect(next).toHaveCount(3);
  await expect(next.first()).toHaveAttribute("href", "/products/p1/sellers");
  expect(await noOverflow(page)).toBe(0);
});

test("the compare table re-runs when the brief area changes", async ({ page }) => {
  await fakeSessions(page, { compare: compareResult });
  await page.goto("/compare?ids=p1,p2");
  const sellersRow = page.getByRole("table").getByRole("row", { name: /فروشنده در محدوده/ });
  await expect(sellersRow).toContainText("۳ فروشنده ثبت‌شده");
  await page.getByRole("region", { name: "خلاصه خرید" }).getByRole("button", { name: /^محدوده/ }).click();
  await page.getByRole("dialog", { name: "محدوده" }).getByRole("button", { name: "فردوسی", exact: true }).click();
  await expect(sellersRow).toContainText("فروشنده‌ای در این محدوده نیست");
});

test("compare picks belong to their chat: a new chat starts empty, a resumed or reloaded chat brings them back", async ({ page }) => {
  await fakeSessions(page, {}, { a: { messages: [{ id: "u1", role: "user", content: "هدفون" }] } });
  await page.addInitScript(() => {
    if (localStorage.getItem("pasazhgard.session")) return;
    localStorage.setItem("pasazhgard.session", "a");
    localStorage.setItem("pasazhgard.sessions", JSON.stringify(["a"]));
  });
  await searchAll(page);
  const sheet = page.getByRole("region", { name: "دستیار" });
  const tray = page.getByRole("region", { name: "سبد مقایسه" });
  const history = page.getByRole("dialog", { name: "تاریخچه" });
  await result(page, "کالای الف").getByRole("button", { name: "افزودن به مقایسه" }).click();
  await expect(tray).toContainText("۱ از ۳");

  await page.reload();
  await expect(tray).toContainText("۱ از ۳");

  await sheet.getByRole("button", { name: "گفتگوی جدید" }).click();
  await expect(sheet.getByText("چه چیزی می‌خواهید حضوری بخرید؟")).toBeVisible();
  await expect(tray).toHaveCount(0);

  await sheet.getByRole("button", { name: "تاریخچه" }).click();
  await history.getByRole("button", { name: "هدفون" }).click();
  await expect(tray).toContainText("۱ از ۳");
  await expect(tray.getByRole("button", { name: "حذف کالای الف از مقایسه" })).toBeVisible();
  expect(await noOverflow(page)).toBe(0);

  // forgetting the chat drops its stored picks
  await sheet.getByRole("button", { name: "گفتگوی جدید" }).click();
  await sheet.getByRole("button", { name: "تاریخچه" }).click();
  await history.getByRole("button", { name: "حذف از تاریخچه" }).click();
  expect(await page.evaluate(() => localStorage.getItem("pasazhgard.compare.a"))).toBeNull();
});
