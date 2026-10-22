import { expect, test } from "@playwright/test";

import { fakeSessions } from "./fake-session";

test("the agent sheet renders blocks at 360 px and a chip answers the question", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/");
  const sheet = page.getByRole("region", { name: "دستیار" });
  await sheet.getByLabel("پیام به دستیار").fill("هدفون انکر");
  await sheet.getByRole("button", { name: "بفرست" }).click();

  await expect(sheet.getByText("هدفون انکر R50i")).toBeVisible();
  await expect(sheet.getByText("این هدفون را پیدا کردم.")).toBeVisible();
  await expect(sheet.getByText("کجا می‌خواهید بروید؟")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  await sheet.getByRole("button", { name: "فردوسی" }).click();
  await expect(sheet.getByText("فردوسی", { exact: true }).first()).toBeVisible();
  await expect(sheet.getByText("این هدفون را پیدا کردم.")).toHaveCount(2);
});

test("an inquiry_status block sends its drafts only on the user's tap and then tracks them at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  const confirmed: number[][] = [];
  let sent = false;
  await page.route("**/api/sessions/*/inquiries/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/confirm")) {
      confirmed.push(route.request().postDataJSON().inquiry_ids);
      sent = true;
      return route.fulfill({ json: { inquiries: [] } });
    }
    const events = [{ at: "2026-10-21T12:00:00+03:30", status: "draft", reply: null }];
    if (sent) events.push({ at: "2026-10-21T12:01:00+03:30", status: "sent", reply: null });
    const inquiry = {
      inquiry_id: 7, offer_id: "o1", product_id: "p1", product_title: "هدفون انکر R50i", shop_id: "shop_a", shop_name: "دیسیلا مانسا",
      status: sent ? "sent" : "draft", message: "سلام", channel: sent ? "seller_console" : null, simulated: sent,
      reply: { available: "unknown", latest_price_toman: null, hold_until: null, installments: null, notes: null, confidence: null }, events,
    };
    return route.fulfill({ contentType: "text/event-stream", body: `retry: 100\ndata: ${JSON.stringify({ inquiries: [inquiry] })}\n\n` });
  });
  await page.goto("/");
  const sheet = page.getByRole("region", { name: "دستیار" });
  await sheet.getByLabel("پیام به دستیار").fill("از این فروشنده بپرس");
  await sheet.getByRole("button", { name: "بفرست" }).click();

  const tracker = sheet.getByRole("region", { name: "استعلام‌ها" });
  await expect(tracker.getByRole("heading", { name: "پیش‌نویس پیام‌ها" })).toBeVisible();
  expect(confirmed).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await tracker.getByRole("button", { name: "ارسال به ۱ فروشنده" }).click();
  await expect(tracker.getByText("ارسال شد، منتظر پاسخ")).toBeVisible();
  expect(confirmed).toEqual([[7]]);
});
