import { expect, test, type Page } from "@playwright/test";

import { askHome, fakeAgent, fakeSessions } from "./fake-session";

const noReply = { available: "unknown", latest_price_toman: null, hold_until: null, installments: null, notes: null, confidence: null };

const inquiry = (inquiry_id: number, shop_name: string, status: string) => ({
  inquiry_id,
  offer_id: `o${inquiry_id}`,
  product_id: "p1",
  product_title: "هندزفری انکر R50i",
  shop_id: `shop_${inquiry_id}`,
  shop_name,
  status,
  message: "سلام",
  channel: status === "closed" ? null : "seller_console",
  simulated: status !== "closed",
  reply: noReply,
  events: [
    { at: "2026-10-21T12:00:00+03:30", status: "draft", reply: null },
    { at: "2026-10-21T12:02:00+03:30", status, reply: null },
  ],
});

const alternative = (shop_id: string, shop_name: string, offer_id: string | null, tradeoff: string) => ({
  kind: offer_id ? "same_product" : "category_only",
  offer_id,
  product_id: "p1",
  product_title: "هندزفری انکر R50i",
  shop_id,
  shop_name,
  pasaj: "علاالدین",
  price_toman: null,
  price_delta_toman: null,
  same_pasaj: true,
  open_now: true,
  distance_m: 9,
  tradeoff,
});

test("no reply and closed inquiries bring up alternatives with one-tap ask and queueing at 360 px", async ({ page }) => {
  await fakeSessions(page, {}, { s9: {} });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "s9"));
  await page.route("**/api/products/p1/sellers/compare**", (route) =>
    route.fulfill({ json: { product_id: "p1", title: "هندزفری انکر R50i", travel_mode: "walk", travel_estimate: "straight_line", sellers: [] } }),
  );
  const inquiries = [inquiry(1, "دیسیلا مانسا", "no_reply"), inquiry(2, "آذرنوش دیسیس", "closed")];
  const posts: { path: string; body: unknown }[] = [];
  await page.route("**/api/sessions/s9/inquiries**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/stream"))
      return route.fulfill({ contentType: "text/event-stream", body: `retry: 100\ndata: ${JSON.stringify({ inquiries })}\n\n` });
    const n = path.match(/inquiries\/(\d+)\/alternatives$/)?.[1];
    if (n === "1")
      return route.fulfill({
        json: {
          inquiry_id: 1,
          reason: "no_reply",
          alternatives: [
            alternative("shop_x", "نیکورا ویوان", "o9", "۲۰۰ هزار تومان ارزان‌تر، همین پاساژ، الان باز است"),
            alternative("shop_y", "دیسورا پاکیار", null, "این کالا را ثبت نکرده، بپرسید، همین پاساژ، الان باز است"),
          ],
        },
      });
    if (n === "2") return route.fulfill({ json: { inquiry_id: 2, reason: "closed", alternatives: [] } });
    posts.push({ path: path.replace("/api/sessions/s9/inquiries", ""), body: req.postDataJSON() });
    return route.fulfill({ status: path.endsWith("/confirm") ? 200 : 201, json: { inquiries: [{ ...inquiry(7, "x", "draft") }] } });
  });
  await page.goto("/products/p1/sellers/compare?offer=o1&offer=o2");

  const tracker = page.getByRole("region", { name: "استعلام‌ها" });
  await expect(tracker.getByText("پاسخ نداد · موجودی تأیید نشده", { exact: true })).toBeVisible();
  await expect(tracker.getByText("فروشگاه الان بسته است", { exact: true })).toBeVisible();
  const block = tracker.getByRole("region", { name: "جایگزین‌ها" });
  await expect(block).toContainText("پاسخ نداد. به جایش:");
  await expect(block).toContainText("۲۰۰ هزار تومان ارزان‌تر، همین پاساژ، الان باز است");

  // one tap: a draft for the alternative, then consent
  await block.getByRole("button", { name: "از این فروشنده بپرس" }).first().click();
  await expect(block.getByRole("button", { name: "پرسیده شد" })).toBeVisible();
  // a shop that does not list the item is asked by shop and product
  await block.getByRole("button", { name: "از این فروشنده بپرس" }).click();
  await expect(block.getByRole("button", { name: "پرسیده شد" })).toHaveCount(2);

  await tracker.getByRole("button", { name: "هنگام باز شدن بفرست" }).click();
  await expect.poll(() => posts.length).toBe(5);
  expect(posts).toEqual([
    // each stands in for the inquiry that fell through, so the visit plan swaps the stop
    { path: "", body: { offer_ids: ["o9"], asks: [], instead_of: 1 } },
    { path: "/confirm", body: { inquiry_ids: [7], queue: false } },
    { path: "", body: { offer_ids: [], asks: [{ product_id: "p1", shop_id: "shop_y" }], instead_of: 1 } },
    { path: "/confirm", body: { inquiry_ids: [7], queue: false } },
    { path: "/confirm", body: { inquiry_ids: [2], queue: true } },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

// a stream that serves `pages` in turn, then the last one; each reconnect gets the next
async function streamInquiries(page: Page, sid: string, pages: object[][]) {
  let n = 0;
  await page.route(`**/api/sessions/${sid}/inquiries**`, (route) => {
    if (!new URL(route.request().url()).pathname.endsWith("/stream")) return route.fulfill({ json: { inquiry_id: 1, reason: "no_reply", alternatives: [] } });
    const inquiries = pages[Math.min(n++, pages.length - 1)];
    return route.fulfill({ contentType: "text/event-stream", body: `retry: 100\ndata: ${JSON.stringify({ inquiries })}\n\n` });
  });
}

test("an alternative asked from the agent's inquiry block shows in that block and updates live at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  const original = inquiry(1, "دیسیلا مانسا", "no_reply");
  await fakeAgent(page, [{ block: "inquiry_status", inquiries: [original] }]);
  const stand = (status: string) => ({ ...inquiry(8, "نیکورا ویوان", status), instead_of: 1 });
  const other = inquiry(9, "رامیلا رامیرا", "sent");
  await streamInquiries(page, "s1", [[original], [original, stand("sent"), other], [original, stand("replied"), other]]);
  await page.goto("/");
  await askHome(page, "از این فروشنده بپرس");

  const tracker = page.getByRole("region", { name: "استعلام‌ها" });
  const card = tracker.getByRole("listitem").filter({ hasText: "نیکورا ویوان" });
  await expect(card).toContainText("به جای دیسیلا مانسا");
  await expect(card.getByText("پاسخ داد · موجودی تأیید نشده", { exact: true })).toBeVisible();
  // another inquiry of the session stays out of this block
  await expect(tracker).not.toContainText("رامیلا رامیرا");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("a similar-product alternative shows in the seller list it was asked from, as the stand-in, at 360 px", async ({ page }) => {
  const list = { product_id: "p1", title: "هندزفری انکر R50i", count: 0, sellers: [], ask_them: [], category_only: [], nearest_covered: null, areas: [], pasajs: [] };
  await fakeSessions(page, { sellers: () => list });
  const original = inquiry(1, "دیسیلا مانسا", "no_reply");
  const similar = { ...inquiry(8, "نیکورا ویوان", "sent"), product_id: "p2", product_title: "هندزفری شیائومی", instead_of: 1 };
  const other = { ...inquiry(9, "رامیلا رامیرا", "sent"), product_id: "p3" };
  await streamInquiries(page, "s1", [[original, similar, other]]);
  await page.goto("/products/p1/sellers");

  const tracker = page.getByRole("region", { name: "استعلام‌ها" });
  const card = tracker.getByRole("listitem").filter({ hasText: "نیکورا ویوان" });
  await expect(card).toContainText("به جای دیسیلا مانسا");
  await expect(card).toContainText("هندزفری شیائومی");
  await expect(tracker).not.toContainText("رامیلا رامیرا");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("the agent posts alternatives in the open chat when an inquiry falls through, without a user turn, at 360 px", async ({ page }) => {
  await fakeSessions(page, {}, { s9: {} });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "s9"));
  await streamInquiries(page, "s9", [[inquiry(1, "دیسیلا مانسا", "no_reply")]]);
  const block = {
    block: "alternatives",
    inquiry_id: 1,
    reason: "no_reply",
    alternatives: [alternative("shop_x", "نیکورا ویوان", "o9", "۲۰۰ هزار تومان ارزان‌تر، همین پاساژ، الان باز است")],
  };
  const posted = [
    { id: "u1", role: "user", content: "هدفون انکر" },
    {
      id: "fallback-1",
      role: "assistant",
      content: "«دیسیلا مانسا» دربارهٔ «هندزفری انکر R50i» جواب نداد. این‌ها را بپرسید:",
      toolCalls: [{ id: "fallback-1", type: "function", function: { name: "find_alternatives", arguments: '{"inquiry_id":1}' } }],
    },
    { id: "fallback-1-result", role: "tool", toolCallId: "fallback-1", content: JSON.stringify(block) },
  ];
  // the reload reads the thread before the post; the stream's event reads it after
  let reads = 0;
  await page.route("**/api/sessions/s9/messages", (route) => route.fulfill({ json: reads++ === 0 ? posted.slice(0, 1) : posted }));
  await page.goto("/");

  const sheet = page.getByRole("region", { name: "دستیار" });
  await expect(sheet.getByText("جواب نداد. این‌ها را بپرسید:")).toBeVisible();
  const alternatives = sheet.getByRole("region", { name: "جایگزین‌ها" });
  await expect(alternatives).toContainText("۲۰۰ هزار تومان ارزان‌تر، همین پاساژ، الان باز است");
  await expect(alternatives.getByRole("button", { name: "از این فروشنده بپرس" })).toBeVisible();
  await expect(sheet.getByText("هدفون انکر", { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
