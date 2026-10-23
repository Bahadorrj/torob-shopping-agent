import { expect, test, type Page } from "@playwright/test";

import { runEvents } from "./agent-events.mjs";
import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const LONG = "یه هندزفری بلوتوثی برای باشگاه میخوام که باتریش زیاد باشه و صداش خوب باشه و زیر دو میلیون باشه";
const user = (id: string, content: string) => ({ id, role: "user", content });
const seed = {
  a: { brief: { must_have: { warranty: true, test_in_presence: false, fast_delivery: false } }, messages: [user("u1", "شارژر اپل"), { id: "x1", role: "assistant", content: "چه مدلی؟" }] },
  b: { messages: [user("u2", LONG)] },
  empty: { messages: [] },
};

const sheet = (page: Page) => page.getByRole("region", { name: "دستیار" });
const history = (page: Page) => page.getByRole("dialog", { name: "تاریخچه" });
const rows = (page: Page) => history(page).getByRole("listitem");
const warranty = (page: Page) => page.getByRole("region", { name: "خلاصه خرید" }).getByRole("button", { name: "گارانتی" });
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
const stored = (page: Page) => page.evaluate(() => [localStorage.getItem("pasazhgard.session"), localStorage.getItem("pasazhgard.sessions")]);

async function withChats(page: Page) {
  const fake = await fakeSessions(page, {}, seed);
  // "gone" 404s and "empty" has no user message: both stay out of the list
  await page.addInitScript(() => {
    if (localStorage.getItem("pasazhgard.session")) return;
    localStorage.setItem("pasazhgard.session", "a");
    localStorage.setItem("pasazhgard.sessions", JSON.stringify(["a", "gone", "empty", "b"]));
  });
  return fake;
}

test("history lists past chats newest first, marks the current one and removes a row locally at 360 px", async ({ page }) => {
  await withChats(page);
  await page.goto("/");
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "گفتگوی جدید" })).toBeEnabled();
  await expect(page.getByText("جلسه‌های اخیر")).toHaveCount(0);

  await sheet(page).getByRole("button", { name: "تاریخچه" }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(0)).toContainText("شارژر اپل");
  await expect(rows(page).nth(0)).toContainText("گفتگوی فعلی");
  await expect(rows(page).nth(1)).not.toContainText("گفتگوی فعلی");
  // the long first message stays on one truncated line
  const title = rows(page).nth(1).getByText(LONG);
  expect((await title.boundingBox())!.height).toBeLessThan(32);
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await fits(page);

  await rows(page).nth(1).getByRole("button", { name: "حذف از تاریخچه" }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(JSON.parse((await stored(page))[1]!)).not.toContain("b");
  // the thread stays where it was
  await page.keyboard.press("Escape");
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
});

test("a past chat resumes from the drawer: thread, chips and the next run's thread id switch to it", async ({ page }) => {
  await withChats(page);
  const runs: string[] = [];
  await fakeAgent(page, [], "باشه", (input) => runs.push((input as unknown as { threadId: string }).threadId));
  await page.goto("/search");
  await expect(warranty(page)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();

  await sheet(page).getByRole("button", { name: "تاریخچه" }).click();
  await rows(page).filter({ hasText: LONG }).getByRole("button", { name: LONG }).click();
  await expect(history(page)).toHaveCount(0);
  await expect(sheet(page).getByText(LONG)).toBeVisible();
  await expect(sheet(page).getByText("شارژر اپل")).toHaveCount(0);
  await expect(warranty(page)).toHaveAttribute("aria-pressed", "false");
  expect((await stored(page))[0]).toBe("b");
  await fits(page);

  await askHome(page, "ادامه بده");
  await expect(sheet(page).getByText("باشه", { exact: true })).toBeVisible();
  expect(runs).toEqual(["b"]);
});

test("new chat creates a session, empties the thread and resets the chips; off while empty or running", async ({ page }) => {
  const { sessions } = await withChats(page);
  // the agent run waits until the test releases it
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/copilotkit", async (route) => {
    const call = route.request().postDataJSON();
    if (call?.method !== "agent/run") return route.fallback();
    await held;
    return route.fulfill({ contentType: "text/event-stream", body: runEvents(call.body, [], "پیدا شد") });
  });
  await page.goto("/search");
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
  await expect(warranty(page)).toHaveAttribute("aria-pressed", "true");

  await sheet(page).getByRole("button", { name: "گفتگوی جدید" }).click();
  await expect(sheet(page).getByRole("log")).toBeEmpty();
  await expect(sheet(page).getByText("شارژر اپل")).toHaveCount(0);
  await expect(warranty(page)).toHaveAttribute("aria-pressed", "false");
  expect(sessions.has("s1")).toBe(true);
  expect((await stored(page))[0]).toBe("s1");
  await expect(sheet(page).getByRole("button", { name: "گفتگوی جدید" })).toBeDisabled();
  await fits(page);

  await askHome(page, "فروشنده‌ها را پیدا کن");
  await expect(sheet(page).getByText("در حال فکر کردن...")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "گفتگوی جدید" })).toBeDisabled();
  release();
  await expect(sheet(page).getByText("پیدا شد")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "گفتگوی جدید" })).toBeEnabled();

  // the previous chat is one tap away
  await sheet(page).getByRole("button", { name: "تاریخچه" }).click();
  await expect(rows(page).filter({ hasText: "شارژر اپل" })).toHaveCount(1);
});
