import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const SENTENCE = "یه هندزفری بلوتوثی برای باشگاه میخوام، حوالی جمهوری، ساعت ۵ عصر، قسطی";
const budget = { block: "chips", field: "budget", question: "حداکثر بودجه‌تان چقدر است؟", options: ["تا ۱ میلیون تومان", "فرقی نمی‌کند"] };
const price = { trust_level: "listed", min_toman: 1000000, max_toman: 2000000, per_meter: false, last_price_changed_at: null, price_age_days: 13, price_age_bucket: "8-30" };
const card = (id: string, title: string, min: number) => ({
  product_id: id, title, brand: null, category: null, image_url: null, key_specs: [], offer_count: 8,
  price: { ...price, min_toman: min }, price_flags: ["placeholder"], score_parts: [{ word: "هدفون", matched: true }], meaning_match: false,
});

const sheet = (page: Page) => page.getByRole("region", { name: "دستیار" });
const chip = (page: Page, name: string) => page.getByRole("region", { name: "خلاصه خرید" }).getByRole("button", { name: new RegExp(`^${name}`) });
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

test("a new chat on home shows only the app bar and the empty input at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "پاساژگرد" })).toBeVisible();
  await expect(page.getByRole("link", { name: "جستجو" })).toHaveAttribute("href", "/search");
  const input = sheet(page).getByLabel("پیام به دستیار");
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("placeholder", /.+/);
  // no greeting, starters, suggestions or brief bar before the first message
  await expect(sheet(page).getByRole("log")).toBeEmpty();
  await expect(sheet(page).getByRole("group", { name: "پیشنهادها" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "خلاصه خرید" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "از یک دسته شروع کنید" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "دستیار خرید" })).toHaveCount(0);
  // the input sits at the bottom of the screen
  const box = (await input.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThan(740 - 72);
  await fits(page);
});

test("user bubbles sit on the right, agent bubbles and blocks on the left, each with a time at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [{ block: "product_cards", query: "هدفون", items: [card("p1", "کالای الف", 1000000)] }], "این‌ها را پیدا کردم");
  await page.goto("/");
  await askHome(page, "هدفون");

  const user = sheet(page).locator("[data-sender=user]").filter({ hasText: "هدفون" });
  const agent = sheet(page).locator("[data-sender=agent]").filter({ hasText: "این‌ها را پیدا کردم" });
  await expect(agent).toBeVisible();
  const u = (await user.boundingBox())!;
  const a = (await agent.boundingBox())!;
  // RTL: the user's start side is the right edge, the agent's end side the left
  expect(u.x + u.width).toBeGreaterThan(330);
  expect(a.x).toBeLessThan(30);
  expect(a.x + a.width).toBeLessThan(330);
  const bg = (l: typeof user) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg(user)).not.toBe(await bg(agent));
  await expect(user.locator("time")).toHaveText(/^[۰-۹]{2}:[۰-۹]{2}$/);
  await expect(agent.locator("time")).toHaveText(/^[۰-۹]{2}:[۰-۹]{2}$/);
  // the block stays in the agent's column
  const cards = (await sheet(page).getByRole("listitem").filter({ hasText: "کالای الف" }).boundingBox())!;
  expect(cards.x).toBeGreaterThanOrEqual(a.x - 1);
  expect(cards.x + cards.width).toBeLessThan(330);
  await fits(page);
});

test("a tapped chip goes to the agent and shows as a pill, not a user bubble", async ({ page }) => {
  const sent: string[] = [];
  const { sessions } = await fakeSessions(page, {});
  await fakeAgent(page, [budget], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");
  await askHome(page, SENTENCE);
  await sheet(page).getByRole("button", { name: "تا ۱ میلیون تومان" }).click();
  await expect.poll(() => sent).toEqual([SENTENCE, "تا ۱ میلیون تومان"]);
  await expect(sheet(page).locator("[data-sender=user]")).toHaveCount(1);
  await expect(sheet(page).locator("[data-sender=user]")).toContainText(SENTENCE);
  await expect(sheet(page).locator("[data-sender=chip]")).toHaveText("تا ۱ میلیون تومان");
  expect(sessions.size).toBe(1);
});

test("a chip message in a restored thread shows as a pill", async ({ page }) => {
  const thread = [
    { id: "u1", role: "user", content: "شارژر اپل" },
    { id: "chip-u2", role: "user", content: "تا ۱ میلیون تومان" },
    { id: "a2", role: "assistant", content: "باشه" },
  ];
  await fakeSessions(page, {}, { old: { messages: thread } });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "old"));
  await page.goto("/");
  await expect(sheet(page).getByText("باشه")).toBeVisible();
  await expect(sheet(page).locator("[data-sender=user]")).toHaveCount(1);
  await expect(sheet(page).locator("[data-sender=chip]")).toHaveText("تا ۱ میلیون تومان");
});

test("a sentence on home runs the agent in place and its chips answer it", async ({ page }) => {
  const sent: string[] = [];
  await fakeSessions(page, {});
  await fakeAgent(page, [budget], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");
  await askHome(page, SENTENCE);

  await expect(sheet(page).getByText(SENTENCE)).toBeVisible();
  await sheet(page).getByRole("button", { name: "تا ۱ میلیون تومان" }).click();
  await expect.poll(() => sent).toEqual([SENTENCE, "تا ۱ میلیون تومان"]);
  await expect(page.locator("[data-slot=drawer-popup]")).toHaveCount(0);
  await fits(page);
});

test("a long chip list shows 8 chips and a search box that filters them at 360 px", async ({ page }) => {
  const names = ["نزدیک من", ...Array.from({ length: 40 }, (_, i) => `محله ${i}`), "پاساژ علاالدين"];
  const sent: string[] = [];
  await fakeSessions(page, {});
  await fakeAgent(page, [{ block: "chips", field: "area", question: "کجا؟", options: names }], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");
  await askHome(page, "هدفون");

  const group = sheet(page).getByRole("group", { name: "کجا؟" });
  await expect(group.getByRole("button")).toHaveCount(8);
  await expect(group.getByRole("button", { name: "نزدیک من" })).toBeVisible();
  // the search folds ی/ي like the area sheet
  await sheet(page).getByLabel("جستجو در گزینه‌ها").fill("علاالدی");
  await expect(group.getByRole("button")).toHaveCount(1);
  await group.getByRole("button", { name: "پاساژ علاالدين" }).click();
  await expect.poll(() => sent).toEqual(["هدفون", "پاساژ علاالدين"]);
  await fits(page);
});

test("a restored thread shows on home without a tap, and in the drawer on another route", async ({ page }) => {
  const thread = [
    { id: "u1", role: "user", content: "شارژر اپل" },
    { id: "a1", role: "assistant", content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "ask_user", arguments: "{}" } }] },
    { id: "t1", role: "tool", toolCallId: "c1", content: JSON.stringify({ ...budget, question: "تا چه قیمتی؟" }) },
  ];
  await fakeSessions(page, {}, { old: { messages: thread } });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "old"));

  await page.goto("/");
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "فرقی نمی‌کند" })).toBeVisible();

  await page.goto("/compare?ids=p1,p2");
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await expect(sheet(page).getByText("تا چه قیمتی؟")).toBeVisible();
});

test("a product card shows one reason, a from-price, its shop count and the sellers link, no details at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [{ block: "product_cards", query: "هدفون", items: [card("p1", "کالای الف", 1000000), card("p2", "کالای ب", 1500000)] }]);
  await page.goto("/");
  await askHome(page, "هدفون");

  const first = page.getByRole("listitem").filter({ hasText: "کالای الف" });
  await expect(first.locator("[data-slot=badge]:not([data-slot=why] *)")).toHaveCount(1);
  await expect(first.locator("[data-slot=badge]:not([data-slot=why] *)")).toHaveText("ارزان‌ترین");
  await expect(first).toContainText("از ۱٫۰۰۰٫۰۰۰ تومان");
  await expect(first).toContainText("در ۸ فروشگاه");
  await expect(first.getByText("قیمت صوری کنار گذاشته شد")).toBeVisible();
  await expect(first.getByRole("link", { name: "دیدن فروشنده‌ها" })).toHaveAttribute("href", "/products/p1/sellers");
  await expect(page.getByRole("listitem").filter({ hasText: "کالای ب" }).locator("[data-slot=badge]:not([data-slot=why] *)")).toHaveText("در ۸ فروشگاه");
  await expect(sheet(page).locator("details")).toHaveCount(0);
  await fits(page);

  // a link in the thread opens its page; the drawer there shows the same thread
  await first.getByRole("link", { name: "دیدن فروشنده‌ها" }).click();
  await expect(page).toHaveURL(/\/products\/p1\/sellers$/);
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await expect(sheet(page).getByText("کالای الف")).toBeVisible();
});

test("a multi-line paste into the chat input goes to basket mode", async ({ page }) => {
  await fakeSessions(page, {});
  await page.route("**/api/basket", (route) => route.abort());
  await page.goto("/");
  await page.getByLabel("پیام به دستیار").evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "سیم ۲.۵\nکلید مینیاتوری");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page).toHaveURL(/\/basket\?text=/);
});

test("search opens from home: results, condition chips, category tiles and pasajs at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  const queries: string[] = [];
  await page.route("**/api/products/search**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q")!;
    queries.push(q);
    return route.fulfill({ json: { query: q, items: [card("p1", `${q} الف`, 1000000), card("p2", `${q} ب`, 1500000)] } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "جستجو" }).click();
  await expect(page).toHaveURL(/\/search$/);

  await expect(chip(page, "الان باز")).toBeVisible();
  const tiles = page.getByRole("region", { name: "از یک دسته شروع کنید" }).getByRole("button");
  expect(await tiles.count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole("region", { name: "پاساژها" }).getByRole("link", { name: /پاساژ علاالدین/ })).toHaveAttribute("href", `/pasajs/${encodeURIComponent("علاالدین")}`);
  // other routes keep the agent bar
  await expect(page.getByRole("button", { name: "دستیار خرید" })).toBeVisible();
  await fits(page);

  await page.getByLabel("جستجوی کالا").fill("هدفون");
  await page.getByLabel("جستجوی کالا").press("Enter");
  const results = page.getByRole("region", { name: "نتیجه‌ها" });
  await expect(results.getByRole("listitem").filter({ hasText: "هدفون الف" }).locator("[data-slot=badge]:not([data-slot=why] *)")).toHaveText("ارزان‌ترین");
  await expect(results.getByRole("link", { name: "دیدن فروشنده‌ها" }).first()).toHaveAttribute("href", "/products/p1/sellers");

  await tiles.filter({ hasText: "ساعت مچی" }).click();
  await expect(results.getByText("ساعت مچی الف")).toBeVisible();
  expect(queries).toEqual(["هدفون", "ساعت مچی"]);
  await fits(page);

  // "all areas" opens the chip bar's area sheet
  await page.getByRole("region", { name: "پاساژها" }).getByRole("button", { name: "همه مناطق" }).click();
  await expect(page.getByRole("dialog", { name: "محدوده" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "بازگشت" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(sheet(page).getByLabel("پیام به دستیار")).toBeVisible();
});

test("a condition chip on search patches the brief before any message", async ({ page }) => {
  const { patches } = await fakeSessions(page, {});
  const sent: string[] = [];
  await fakeAgent(page, [], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/search");
  await chip(page, "گارانتی").click();
  await expect.poll(() => patches.at(-1)?.brief?.must_have).toEqual({ warranty: true, test_in_presence: false, fast_delivery: false });
  await expect(chip(page, "گارانتی")).toHaveAttribute("aria-pressed", "true");
  expect(sent).toEqual([]);
});

test("a product card with the most score chips and its sentence fits at 360 px", async ({ page }) => {
  const parts = [{ word: "هندزفری", matched: true }, { word: "بلوتوثی", matched: true }, { word: "انکر", matched: true }, { word: "مشکی", matched: false }];
  await fakeSessions(page, {});
  await fakeAgent(page, [{ block: "product_cards", query: "x", items: [{ ...card("p1", "کالای الف", 1000000), price_flags: [], score_parts: parts, meaning_match: true }] }]);
  await page.goto("/");
  await askHome(page, "x");

  const item = page.getByRole("listitem").filter({ hasText: "کالای الف" });
  await expect(item.locator("[data-slot=why] [data-slot=badge]")).toHaveCount(5);
  await expect(item).toContainText("«مشکی» در آن پیدا نشد؛ از نظر معنی به جستجوی شما نزدیک است؛ ۸ فروشگاه آن را دارند.");
  await fits(page);
});
