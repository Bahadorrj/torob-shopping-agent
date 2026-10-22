import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const SENTENCE = "یه هندزفری بلوتوثی برای باشگاه میخوام، حوالی جمهوری، ساعت ۵ عصر، قسطی";
const budget = { block: "chips", field: "budget", question: "حداکثر بودجه‌تان چقدر است؟", options: ["تا ۱ میلیون تومان", "فرقی نمی‌کند"] };

const sheet = (page: Page) => page.getByRole("region", { name: "دستیار" });
const chip = (page: Page, name: string) => page.getByRole("region", { name: "خلاصه خرید" }).getByRole("button", { name: new RegExp(`^${name}`) });
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("the home input asks the agent, the sheet opens on its chips and the brief bar follows at 360 px", async ({ page }) => {
  const { sessions } = await fakeSessions(page, {});
  const sent: string[] = [];
  // the agent patches the brief on the server during its turn
  await fakeAgent(page, [budget], "", ({ messages }) => {
    sent.push(String(messages.at(-1)?.content));
    const s = sessions.get("s1")!;
    s.brief = { ...s.brief, area: { radius_m: null, name: "جمهوری", pasaj: null }, payment: { kind: "installment", provider: null } };
  });
  await page.goto("/");
  await expect(chip(page, "محدوده")).toHaveAccessibleName("محدوده: همه مناطق");

  await askHome(page, SENTENCE);

  await expect(sheet(page).getByText(SENTENCE)).toBeVisible();
  await expect(sheet(page).getByText("حداکثر بودجه‌تان چقدر است؟")).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("جمهوری");
  await expect(chip(page, "اقساطی")).toHaveAttribute("aria-pressed", "true");
  expect(await noOverflow(page)).toBe(0);

  await sheet(page).getByRole("button", { name: "تا ۱ میلیون تومان" }).click();
  await expect.poll(() => sent).toEqual([SENTENCE, "تا ۱ میلیون تومان"]);
  await sheet(page).getByRole("button", { name: "بستن" }).click();

  // a bare product name goes to the agent too
  await askHome(page, "هدفون انکر");
  await expect.poll(() => sent.at(-1)).toBe("هدفون انکر");
  expect(await noOverflow(page)).toBe(0);
});

test("a reload or another route shows the session's thread again", async ({ page }) => {
  const thread = [
    { id: "u1", role: "user", content: "شارژر اپل" },
    { id: "a1", role: "assistant", content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "ask_user", arguments: "{}" } }] },
    { id: "t1", role: "tool", toolCallId: "c1", content: JSON.stringify({ ...budget, question: "تا چه قیمتی؟" }) },
  ];
  await fakeSessions(page, {}, { old: { messages: thread } });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "old"));

  await page.goto("/");
  // a restored thread waits for a tap on the agent bar
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "فرقی نمی‌کند" })).toBeVisible();

  await page.goto("/compare?ids=p1,p2");
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await expect(sheet(page).getByText("تا چه قیمتی؟")).toBeVisible();
});

test("home shows search, condition chips, category tiles and pasajs; a tile sends its starter at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  const sent: string[] = [];
  await fakeAgent(page, [], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");

  await expect(page.getByLabel("خرید شما در یک جمله")).toBeVisible();
  await expect(chip(page, "الان باز")).toBeVisible();
  const tiles = page.getByRole("region", { name: "از یک دسته شروع کنید" }).getByRole("button");
  expect(await tiles.count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole("region", { name: "پاساژها" }).getByRole("link", { name: /پاساژ علاالدین/ })).toHaveAttribute("href", `/pasajs/${encodeURIComponent("علاالدین")}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  // "all areas" opens the chip bar's area sheet
  await page.getByRole("region", { name: "پاساژها" }).getByRole("button", { name: "همه مناطق" }).click();
  await expect(page.getByRole("dialog", { name: "محدوده" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "محدوده" })).toHaveCount(0);

  await tiles.filter({ hasText: "هدفون و هندزفری" }).click();
  await expect.poll(() => sent).toEqual(["هدفون و هندزفری می‌خواهم"]);
  await expect(sheet(page).getByText("هدفون و هندزفری می‌خواهم")).toBeVisible();
});

test("a condition chip on home patches the brief before any message", async ({ page }) => {
  const { patches } = await fakeSessions(page, {});
  const sent: string[] = [];
  await fakeAgent(page, [], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");
  await chip(page, "گارانتی").click();
  await expect.poll(() => patches.at(-1)?.brief?.must_have).toEqual({ warranty: true, test_in_presence: false, fast_delivery: false });
  await expect(chip(page, "گارانتی")).toHaveAttribute("aria-pressed", "true");
  expect(sent).toEqual([]);
});

test("a product card shows one reason, a from-price, its shop count and the sellers link, no details at 360 px", async ({ page }) => {
  const price = { trust_level: "listed", min_toman: 1000000, max_toman: 2000000, per_meter: false, last_price_changed_at: null, price_age_days: 13, price_age_bucket: "8-30" };
  const card = (id: string, title: string, min: number) => ({
    product_id: id, title, brand: null, category: null, image_url: null, key_specs: [], offer_count: 8,
    price: { ...price, min_toman: min }, price_flags: ["placeholder"], score_parts: [{ word: "هدفون", matched: true }], meaning_match: false,
  });
  await fakeSessions(page, {});
  await fakeAgent(page, [{ block: "product_cards", query: "هدفون", items: [card("p1", "کالای الف", 1000000), card("p2", "کالای ب", 1500000)] }]);
  await page.goto("/");
  await askHome(page, "هدفون");

  const first = page.getByRole("listitem").filter({ hasText: "کالای الف" });
  await expect(first.locator("[data-slot=badge]")).toHaveCount(1);
  await expect(first.locator("[data-slot=badge]")).toHaveText("ارزان‌ترین");
  await expect(first).toContainText("از ۱٫۰۰۰٫۰۰۰ تومان");
  await expect(first).toContainText("در ۸ فروشگاه");
  await expect(first.getByText("قیمت صوری کنار گذاشته شد")).toBeVisible();
  await expect(first.getByRole("link", { name: "دیدن فروشنده‌ها" })).toHaveAttribute("href", "/products/p1/sellers");
  await expect(page.getByRole("listitem").filter({ hasText: "کالای ب" }).locator("[data-slot=badge]")).toHaveText("در ۸ فروشگاه");
  await expect(sheet(page).locator("details")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("a multi-line paste on home goes to basket mode", async ({ page }) => {
  await fakeSessions(page, {});
  await page.route("**/api/basket", (route) => route.abort());
  await page.goto("/");
  await page.getByLabel("خرید شما در یک جمله").evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "سیم ۲.۵\nکلید مینیاتوری");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page).toHaveURL(/\/basket\?text=/);
});
