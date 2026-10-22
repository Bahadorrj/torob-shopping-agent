import { expect, test } from "@playwright/test";

import { fakeSessions } from "./fake-session";

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
  await expect(tracker.getByText("پاسخ نداد", { exact: true })).toBeVisible();
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
    { path: "", body: { offer_ids: ["o9"], asks: [] } },
    { path: "/confirm", body: { inquiry_ids: [7], queue: false } },
    { path: "", body: { offer_ids: [], asks: [{ product_id: "p1", shop_id: "shop_y" }] } },
    { path: "/confirm", body: { inquiry_ids: [7], queue: false } },
    { path: "/confirm", body: { inquiry_ids: [2], queue: true } },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
