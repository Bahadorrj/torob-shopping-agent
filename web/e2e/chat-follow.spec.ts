import { expect, test, type Page } from "@playwright/test";

import { runEvents } from "./agent-events.mjs";
import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const price = { trust_level: "listed", min_toman: 1000000, max_toman: 2000000, per_meter: false, last_price_changed_at: null, price_age_days: 13, price_age_bucket: "8-30" };
const card = (id: string) => ({
  product_id: id, title: `کالای ${id}`, brand: null, category: null, image_url: null, key_specs: [], offer_count: 8,
  price, price_flags: [], score_parts: [], meaning_match: false,
});
const cards = { block: "product_cards", query: "هدفون", items: [card("p1"), card("p2"), card("p3")] };
const budget = { block: "chips", field: "budget", question: "حداکثر بودجه‌تان چقدر است؟", options: ["تا ۱ میلیون تومان", "فرقی نمی‌کند"] };

const sheet = (page: Page) => page.getByRole("region", { name: "دستیار" });
const log = (page: Page) => sheet(page).getByRole("log");
const scrollUp = (page: Page) => log(page).evaluate((el) => el.scrollTo({ top: 0 }));
const atBottom = (page: Page) => log(page).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 8);

test("the second turn scrolls into view at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [cards], "این‌ها را پیدا کردم");
  await page.goto("/");
  await askHome(page, "هدفون");
  await expect(sheet(page).getByText("این‌ها را پیدا کردم")).toHaveCount(1);
  await askHome(page, "ارزان‌ترش");
  await expect(sheet(page).getByText("این‌ها را پیدا کردم")).toHaveCount(2);
  await expect(sheet(page).getByText("ارزان‌ترش")).toBeInViewport();
  await expect(sheet(page).getByText("این‌ها را پیدا کردم").last()).toBeInViewport();
  await expect.poll(() => atBottom(page)).toBe(true);
});

test("within one run the agent's text comes before its blocks", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [cards], "این‌ها را پیدا کردم");
  await page.goto("/");
  await askHome(page, "هدفون");
  const text = (await sheet(page).getByText("این‌ها را پیدا کردم").boundingBox())!;
  const first = (await log(page).getByRole("listitem").first().boundingBox())!;
  expect(text.y).toBeLessThan(first.y);
});

test("a user scrolled up sees a new-message pill that scrolls down at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  let release = () => {};
  let runs = 0;
  await page.route("**/api/copilotkit", async (route) => {
    const call = route.request().postDataJSON();
    if (call?.method !== "agent/run") return route.fallback();
    if (runs++ > 0) await new Promise<void>((r) => (release = r));
    return route.fulfill({ contentType: "text/event-stream", body: runEvents(call.body, [cards, cards], `پاسخ ${runs}`) });
  });
  await page.goto("/");
  await askHome(page, "هدفون");
  await expect(sheet(page).getByText("پاسخ 1")).toBeVisible();
  await askHome(page, "ارزان‌ترش");
  await expect(sheet(page).getByText("در حال فکر کردن...")).toBeVisible();
  await scrollUp(page);
  await expect(sheet(page).getByText("هدفون", { exact: true })).toBeInViewport();
  release();
  const pill = sheet(page).getByRole("button", { name: "پیام جدید" });
  await expect(pill).toBeVisible();
  await expect(sheet(page).getByText("هدفون", { exact: true })).toBeInViewport();
  await pill.click();
  await expect.poll(() => atBottom(page)).toBe(true);
  await expect(pill).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("a tapped chip shows as a muted pill and splits the agent runs at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [budget], "باشه");
  await page.goto("/");
  await askHome(page, "هدفون");
  await expect(sheet(page).getByText("باشه")).toHaveCount(1);
  await sheet(page).getByRole("button", { name: "تا ۱ میلیون تومان" }).first().click();
  const pill = sheet(page).locator("[data-sender=chip]");
  await expect(pill).toHaveText("تا ۱ میلیون تومان");
  await expect(pill).toBeInViewport();
  await expect(pill.locator("time")).toHaveCount(0);
  const agents = sheet(page).locator("[data-sender=agent]").filter({ hasText: "باشه" });
  await expect(agents).toHaveCount(2);
  // a run after the pill starts a new group: the wide gap, not the tight one
  const second = await agents.nth(1).evaluate((el) => parseFloat(getComputedStyle(el.parentElement!).marginTop));
  expect(second).toBeGreaterThanOrEqual(16);
});

test("a reloaded thread shows suggestion and chip taps as pills by their visible text", async ({ page }) => {
  const thread = [
    { id: "chip-u1", role: "user", content: "گزینه‌های ارزان‌تر نشان بده" },
    { id: "a1", role: "assistant", content: "باشه" },
    { id: "chip-u2", role: "user", content: "تا ۱ میلیون تومان" },
    { id: "a2", role: "assistant", content: "حتما" },
  ];
  await fakeSessions(page, {}, { old: { messages: thread } });
  await page.addInitScript(() => {
    localStorage.setItem("pasazhgard.session", "old");
    localStorage.setItem("pasazhgard.sessions", JSON.stringify(["old"]));
  });
  await page.goto("/");
  const pills = sheet(page).locator("[data-sender=chip]");
  await expect(pills).toHaveText(["ارزان‌تر", "تا ۱ میلیون تومان"]);
  await expect(sheet(page).locator("[data-sender=user]")).toHaveCount(0);
  const gap = await sheet(page).locator("[data-sender=agent]").filter({ hasText: "حتما" }).evaluate((el) => parseFloat(getComputedStyle(el.parentElement!).marginTop));
  expect(gap).toBeGreaterThanOrEqual(16);

  await sheet(page).getByRole("button", { name: "تاریخچه" }).click();
  const row = page.getByRole("dialog", { name: "تاریخچه" }).getByRole("listitem");
  await expect(row).toContainText("ارزان‌تر");
  await expect(row).not.toContainText("گزینه‌های ارزان‌تر نشان بده");
});

test("an empty chat asks what you need; timestamps and header actions are readable and tappable", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeAgent(page, [], "باشه");
  await page.goto("/");
  const input = sheet(page).getByLabel("پیام به دستیار");
  await expect(input).toHaveAttribute("placeholder", "چه چیزی لازم دارید؟");
  for (const name of ["گفتگوی جدید", "تاریخچه"]) {
    const box = (await sheet(page).getByRole("button", { name }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await askHome(page, "هدفون");
  await expect(sheet(page).getByText("باشه")).toBeVisible();
  await expect(input).toHaveAttribute("placeholder", "بپرسید یا شرط اضافه کنید");
  for (const time of await sheet(page).locator("time").all())
    expect(await time.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
});
