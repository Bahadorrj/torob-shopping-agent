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
  // visit_plan: the stops in order with open-at-ETA, and a link to the plan screen
  await expect(sheet.getByText("دیسورا پاکیار")).toBeVisible();
  await expect(sheet.getByText("ساعت کاری ثبت نشده")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "دیدن برنامه روی نقشه" })).toHaveAttribute(
    "href",
    "/plan?shop_id=shop_a&shop_id=shop_b&lat=35.69&lon=51.42&mode=walk&depart_at=2026-10-22T13%3A35%3A00%2B03%3A30",
  );
  // directions: route, last leg and map app links
  await expect(sheet.getByText("پاساژ علاالدین، رو‌به‌روی پاساژ چهارسو، طبقه ۲، واحد ۲۱۶")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "باز کردن در نشان" })).toBeVisible();
  // alternatives: the reason, a trade-off line and a one-tap ask
  const alternatives = sheet.getByRole("region", { name: "جایگزین‌ها" });
  await expect(alternatives).toContainText("پاسخ نداد. به جایش:");
  await expect(alternatives).toContainText("۲۰۰ هزار تومان ارزان‌تر، همین پاساژ، الان باز است");
  await expect(alternatives.getByRole("button", { name: "از این فروشنده بپرس" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  await sheet.getByRole("button", { name: "فردوسی" }).click();
  await expect(sheet.getByText("فردوسی", { exact: true }).first()).toBeVisible();
  await expect(sheet.getByText("این هدفون را پیدا کردم.")).toHaveCount(2);
});

// same file as the test above: the runtime refuses two runs on one fake session thread at once
test("help me choose on the home screen shows the model shortlist at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/");
  const sheet = page.getByRole("region", { name: "دستیار" });
  // the sheet offers the same entry before the first message
  await expect(sheet.getByRole("button", { name: "کمکم کن انتخاب کنم" })).toBeVisible();

  await page.getByRole("main").getByRole("button", { name: "کمکم کن انتخاب کنم" }).click();

  await expect(sheet.getByText("کمکم کن انتخاب کنم")).toBeVisible();
  await expect(sheet.getByText("هندزفری بلوتوثی انکر R50i NC")).toBeVisible();
  await expect(sheet.getByText("قابلیت حذف نویز (ANC): دارد")).toBeVisible();
  await expect(sheet.getByText("۴ فروشنده در این محدوده").first()).toBeVisible();
  await expect(sheet.getByRole("link", { name: "مقایسه این مدل‌ها" })).toHaveAttribute("href", "/compare?ids=p2%2Cp3");
  const r50iNc = sheet.getByRole("listitem").filter({ hasText: "هندزفری بلوتوثی انکر R50i NC" });
  await expect(r50iNc.getByRole("link", { name: "دیدن فروشنده‌ها" })).toHaveAttribute("href", "/products/p2/sellers");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
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
