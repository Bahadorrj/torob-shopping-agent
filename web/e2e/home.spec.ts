import { expect, test, type Page } from "@playwright/test";

import { fakeAgent, fakeSessions } from "./fake-session";

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

  await page.getByRole("main").getByRole("button", { name: SENTENCE }).click();

  await expect(sheet(page).getByText(SENTENCE)).toBeVisible();
  await expect(sheet(page).getByText("حداکثر بودجه‌تان چقدر است؟")).toBeVisible();
  await expect(chip(page, "محدوده")).toContainText("جمهوری");
  await expect(chip(page, "اقساطی")).toHaveAttribute("aria-pressed", "true");
  expect(await noOverflow(page)).toBe(0);

  await sheet(page).getByRole("button", { name: "تا ۱ میلیون تومان" }).click();
  await expect.poll(() => sent).toEqual([SENTENCE, "تا ۱ میلیون تومان"]);

  // a bare product name goes to the agent too
  await page.getByLabel("خرید شما در یک جمله").fill("هدفون انکر");
  await page.getByRole("button", { name: "بپرس" }).click();
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
  await expect(sheet(page).getByText("شارژر اپل")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "فرقی نمی‌کند" })).toBeVisible();

  await page.goto("/compare?ids=p1,p2");
  await expect(sheet(page).getByText("تا چه قیمتی؟")).toBeVisible();
});
