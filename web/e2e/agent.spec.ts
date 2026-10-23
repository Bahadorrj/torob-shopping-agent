import { expect, test, type Page } from "@playwright/test";

import { fakeAgent, fakeSessions } from "./fake-session";

const openAgent = (page: Page) => page.getByRole("button", { name: "دستیار خرید" }).click();
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

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
  await expect(sheet.getByText("ساعت کاری: نامشخص")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "دیدن برنامه روی نقشه" })).toHaveAttribute(
    "href",
    "/plan?shop_id=shop_a&shop_id=shop_b&lat=35.69&lon=51.42&mode=walk&depart_at=2026-10-22T13%3A35%3A00%2B03%3A30&session_id=s1",
  );
  // directions: route, last leg and map app links
  await expect(sheet.getByText("پاساژ علاالدین، رو‌به‌روی پاساژ چهارسو، طبقه ۲، واحد ۲۱۶")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "باز کردن در نشان" })).toBeVisible();
  // shop_details: location and today's hours from the tool, the week on the shop page
  await expect(sheet.getByText("پاساژ علاالدین، طبقه ۲، واحد ۲۱۶")).toBeVisible();
  await expect(sheet.getByText("امروز: ۱۰:۰۰ تا ۲۱:۰۰")).toBeVisible();
  await expect(sheet.getByRole("link", { name: "ساعت کاری هفته و جزئیات فروشگاه" })).toHaveAttribute("href", "/shops/shop_d");
  // product: a link to the product's sellers
  await expect(sheet.getByText("کابل شارژ انکر")).toBeVisible();
  // the shortlist in the same fake run has links with this name too
  await expect(sheet.locator('a[href="/products/p4/sellers"]')).toHaveText("دیدن فروشنده‌ها");
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
  // the thread offers it as a starter before the first message
  await sheet.getByRole("button", { name: "کمکم کن انتخاب کنم" }).click();

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

test("a stored thread waits behind the agent bar on the sellers route", async ({ page }) => {
  await fakeSessions(page, {}, { old: { step: { kind: "sellers", product_id: "x" }, messages: [{ id: "u1", role: "user", content: "شارژر اپل" }] } });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "old"));
  const thread = page.waitForResponse("**/api/sessions/old/messages");
  await page.goto("/products/x/sellers");
  await thread;
  const sheet = page.getByRole("region", { name: "دستیار" });
  await expect(page.getByRole("button", { name: "دستیار خرید" })).toBeVisible();
  await expect(sheet).toHaveCount(0);

  await openAgent(page);
  await expect(sheet.getByText("شارژر اپل")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("a running tool shows its skeleton until its block arrives", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/");
  const sheet = page.getByRole("region", { name: "دستیار" });
  // fake-agent.mjs holds this find_sellers result back for two seconds
  await sheet.getByLabel("پیام به دستیار").fill("فروشنده‌ها را پیدا کن");
  await sheet.getByRole("button", { name: "بفرست" }).click();

  const busy = sheet.getByRole("status").filter({ hasText: "در حال یافتن فروشنده‌ها" });
  await expect(busy).toBeVisible();
  await expect(busy.locator("[data-slot=skeleton]").first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await expect(sheet.getByText("دیسیلا مانسا")).toBeVisible();
  await expect(busy).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("product cards end in suggestion chips that send their message", async ({ page }) => {
  await fakeSessions(page, {});
  const sent: string[] = [];
  const product = {
    product_id: "p1", title: "کالای الف", brand: null, category: null, image_url: null, key_specs: [], offer_count: 2,
    price: { trust_level: "listed", min_toman: 1000000, max_toman: 1000000, per_meter: false, last_price_changed_at: null, price_age_days: null, price_age_bucket: null },
    price_flags: [], score_parts: [], meaning_match: false,
  };
  await fakeAgent(page, [{ block: "product_cards", query: "x", items: [product] }], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");
  const sheet = page.getByRole("region", { name: "دستیار" });
  await sheet.getByLabel("پیام به دستیار").fill("کالای الف");
  await sheet.getByRole("button", { name: "بفرست" }).click();

  await expect(sheet.getByText("کالای الف").last()).toBeVisible();
  const chips = sheet.getByRole("group", { name: "پیشنهادها" }).getByRole("button");
  await expect(chips.first()).toBeVisible();
  expect(await chips.count()).toBeGreaterThanOrEqual(3);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await chips.filter({ hasText: "مقایسه این دو" }).click();
  await expect.poll(() => sent).toEqual(["کالای الف", "این دو مدل را مقایسه کن"]);
});

test("the drawer has a handle, closes by swipe or the close button and keeps the top of the page in view", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/search");
  const sheet = page.getByRole("region", { name: "دستیار" });

  await openAgent(page);
  await expect(sheet).toBeVisible();
  const handle = page.locator("[data-slot=drawer-swipe-handle]");
  await expect(handle).toBeVisible();
  // snap point 0.9: the top tenth of the 740 px screen (the app bar) stays visible
  const popup = await page.locator("[data-slot=drawer-popup]").boundingBox();
  expect(popup!.y).toBeGreaterThanOrEqual(73);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await sheet.getByRole("button", { name: "بستن" }).click();
  await expect(sheet).toHaveCount(0);

  await openAgent(page);
  await expect(sheet).toBeVisible();
  // a drag that starts while the drawer still slides in is not a swipe
  await page.waitForFunction(() => document.querySelector("[data-slot=drawer-popup]")?.getAnimations().length === 0);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let dy = 40; dy <= 480; dy += 40) await page.mouse.move(box.x + box.width / 2, box.y + dy);
  await page.mouse.up();
  await expect(sheet).toHaveCount(0);
});

const originChips = { block: "chips", field: "origin", question: "از کجا شروع می‌کنید؟", options: ["موقعیت من", "فردوسی", "علاالدین"] };

test("origin chips at 360 px: my location sets the origin from geolocation, then the chip text goes to the agent", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.7, longitude: 51.4 });
  const { patches } = await fakeSessions(page, {});
  const sent: string[] = [];
  await fakeAgent(page, [originChips], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");
  const sheet = page.getByRole("region", { name: "دستیار" });
  await sheet.getByLabel("پیام به دستیار").fill("برنامهٔ رفتن");
  await sheet.getByRole("button", { name: "بفرست" }).click();

  const chips = sheet.getByRole("group", { name: "از کجا شروع می‌کنید؟" });
  await expect(chips.getByRole("button")).toHaveCount(3);
  expect(await overflow(page)).toBe(0);
  await chips.getByRole("button", { name: "موقعیت من" }).click();

  await expect.poll(() => sent.at(-1)).toBe("مبدأ من: موقعیت من");
  expect(patches.at(-1)).toEqual({ brief: { origin: { lat: 35.7, lon: 51.4 } } });
});

test("an area origin chip sets the origin to that area's center", async ({ page }) => {
  const { patches } = await fakeSessions(page, {});
  const sent: string[] = [];
  await fakeAgent(page, [originChips], "", ({ messages }) => sent.push(String(messages.at(-1)?.content)));
  await page.goto("/");
  const sheet = page.getByRole("region", { name: "دستیار" });
  await sheet.getByLabel("پیام به دستیار").fill("برنامهٔ رفتن");
  await sheet.getByRole("button", { name: "بفرست" }).click();

  await sheet.getByRole("group", { name: "از کجا شروع می‌کنید؟" }).getByRole("button", { name: "فردوسی" }).click();

  await expect.poll(() => sent.at(-1)).toBe("مبدأ من: فردوسی");
  expect(patches.at(-1)).toEqual({ brief: { origin: { lat: 35.6905, lon: 51.4172 } } });
});
