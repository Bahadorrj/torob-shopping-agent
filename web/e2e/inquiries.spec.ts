import { expect, test, type Page } from "@playwright/test";

import { fakeSessions } from "./fake-session";

const AT = "2026-10-21T12:05:00+03:30";
const noReply = { available: "unknown", latest_price_toman: null, hold_until: null, installments: null, notes: null, confidence: null };

const column = (offer_id: string, shop_id: string, shop_name: string) => ({
  offer_id,
  shop_id,
  shop_name,
  area: "شیخ هادی",
  pasaj: "علاالدین",
  floor: null,
  unit: null,
  lat: null,
  lon: null,
  distance_m: null,
  price_toman: 3500000,
  per_meter: false,
  price_age_days: 22,
  price_age_bucket: "8-30",
  trust_level: "listed",
  warranty: null,
  declared_hours: false,
  open_now: null,
  payment_options: [],
  reasons: [],
  unknown: [],
  latest_price: { status: "not_asked", price_toman: null, trust_level: "unknown", at: null } as object,
  inquiry: null as object | null,
  travel_min: null,
  arrival_at: "2026-10-21T12:00:00+03:30",
  open_at_arrival: null,
  fast_delivery: "unknown",
});

const shops = [
  ["o1", "shop_a", "دیسیلا مانسا"],
  ["o2", "shop_b", "نیین ماهیس"],
  ["o3", "shop_c", "نیکورا ویوان"],
] as const;

const inquiry = (n: number) => ({
  inquiry_id: n + 1,
  offer_id: shops[n][0],
  product_id: "p1",
  product_title: "هندزفری انکر R50i",
  shop_id: shops[n][1],
  shop_name: shops[n][2],
  status: "draft",
  message: "سلام، وقت بخیر. درباره «هندزفری انکر R50i» سؤال داشتم: الان موجود است؟ ممنون.",
  channel: null as string | null,
  simulated: false,
  reply: { ...noReply } as Record<string, unknown>,
  events: [{ at: "2026-10-21T12:00:00+03:30", status: "draft", reply: null }] as { at: string; status: string; reply: object | null }[],
});

type Inquiry = ReturnType<typeof inquiry>;

const sse = (data: object) => ({ contentType: "text/event-stream", body: `retry: 100\ndata: ${JSON.stringify(data)}\n\n` });

// In-page stand-in for the inquiry API and its SSE stream; the stream is re-served every 100 ms.
async function fakeInquiries(page: Page) {
  const state = { inquiries: [] as Inquiry[], confirmed: [] as number[][], composed: [] as string[][] };
  await page.route("**/api/sessions/*/inquiries**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/stream")) return route.fulfill(sse({ inquiries: state.inquiries }));
    if (path.endsWith("/confirm")) {
      const ids: number[] = req.postDataJSON().inquiry_ids;
      state.confirmed.push(ids);
      for (const i of state.inquiries)
        if (ids.includes(i.inquiry_id)) {
          Object.assign(i, { status: "sent", channel: "seller_console", simulated: true });
          i.events.push({ at: "2026-10-21T12:01:00+03:30", status: "sent", reply: null });
        }
      return route.fulfill({ json: { inquiries: state.inquiries } });
    }
    const offers: string[] = req.postDataJSON().offer_ids;
    state.composed.push(offers);
    state.inquiries = offers.map((o) => inquiry(shops.findIndex((s) => s[0] === o)));
    return route.fulfill({ status: 201, json: { inquiries: state.inquiries } });
  });
  return state;
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("ask three sellers: drafts first, send on consent, replies update the tracker and compare at 360 px", async ({ page }) => {
  await fakeSessions(page, {}, { s9: {} });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "s9"));
  const cols = shops.map(([o, s, n]) => column(o, s, n));
  const compareRequests: URLSearchParams[] = [];
  await page.route("**/api/products/p1/sellers/compare**", (route) => {
    compareRequests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { product_id: "p1", title: "هندزفری انکر R50i", travel_mode: "walk", travel_estimate: "straight_line", sellers: cols } });
  });
  const state = await fakeInquiries(page);
  await page.goto("/products/p1/sellers/compare?offer=o1&offer=o2&offer=o3");

  await page.getByRole("button", { name: "استعلام از ۳ فروشنده" }).click();
  await expect(page.getByRole("heading", { name: "پیش‌نویس پیام‌ها" })).toBeVisible();
  await expect(page.getByText("تا وقتی تأیید نکنید، پیامی برای فروشنده فرستاده نمی‌شود.")).toBeVisible();
  expect(state.composed).toEqual([["o1", "o2", "o3"]]);
  // nothing is sent before consent
  expect(state.confirmed).toEqual([]);
  expect(await noOverflow(page)).toBe(0);

  await page.getByRole("button", { name: "ارسال به ۳ فروشنده" }).click();
  await expect(page.getByRole("heading", { name: "پیگیری استعلام‌ها" })).toBeVisible();
  expect(state.confirmed).toEqual([[1, 2, 3]]);
  const tracker = page.getByRole("region", { name: "استعلام‌ها" });
  await expect(tracker.getByText("ارسال شد، منتظر پاسخ")).toHaveCount(3);
  await expect(tracker.getByText("شبیه‌سازی", { exact: true })).toHaveCount(3);
  await expect(tracker.getByText("۱۲:۰۱ - پیام ارسال شد")).toHaveCount(3);

  // the seller confirms from the Seller Console
  const mansa = state.inquiries[0];
  mansa.status = "confirmed";
  mansa.reply = { ...noReply, available: "yes", latest_price_toman: 3400000, hold_until: "17:00:00", confidence: 1 };
  mansa.events.push(
    { at: AT, status: "replied", reply: { latest_price_toman: 3400000 } },
    { at: AT, status: "confirmed", reply: { available: "yes" } },
    { at: AT, status: "confirmed", reply: { hold_until: "17:00:00" } },
  );
  cols[0].latest_price = { status: "confirmed", price_toman: 3400000, trust_level: "confirmed", at: AT };
  cols[0].inquiry = { inquiry_id: 1, status: "confirmed", available: "yes", latest_price_toman: 3400000, hold_until: "17:00:00", installments: true, replied_at: AT };

  await expect(tracker.getByText("موجودی تأیید شد")).toBeVisible();
  await expect(tracker).toContainText("قیمت تأییدشده توسط فروشنده: ۳٬۴۰۰٬۰۰۰ تومان - ساعت ۱۲:۰۵");
  await expect(tracker).toContainText("نگه می‌دارد تا ساعت ۱۷:۰۰");
  await expect(tracker).toContainText("۱۲:۰۵ - فروشنده: موجود است");

  const table = page.getByRole("table");
  const row = (name: string) => table.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
  await expect(row("آخرین قیمت")).toContainText("۳٬۴۰۰٬۰۰۰ تومان");
  await expect(row("آخرین قیمت")).toContainText("تأیید فروشنده - ساعت ۱۲:۰۵");
  await expect(row("موجودی")).toContainText("موجود است - ساعت ۱۲:۰۵");
  await expect(row("پرداخت و اقساط")).toContainText("اقساط یا ترب‌پی (تأیید فروشنده)");
  await expect(row("اعتبار قیمت")).toContainText("تأییدشده");
  // the compare reads this session's inquiries
  expect(compareRequests.at(-1)!.get("session_id")).toBe("s9");
  expect(await noOverflow(page)).toBe(0);
});

test("seller console: simulated label, incoming message and quick replies at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  const sent = { ...inquiry(0), status: "sent", channel: "seller_console", simulated: true };
  await page.route("**/api/console/shops/shop_a/inquiries/stream", (route) =>
    route.fulfill(sse({ shop_id: "shop_a", shop_name: "دیسیلا مانسا", inquiries: [sent] })),
  );
  const replies: object[] = [];
  await page.route("**/api/console/inquiries/1/replies", (route) => {
    replies.push(route.request().postDataJSON());
    return route.fulfill({ json: sent });
  });
  await page.goto("/console/shop_a");

  await expect(page.getByRole("heading", { name: "کنسول فروشنده - دیسیلا مانسا" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("شبیه‌سازی");
  await expect(page.getByText(sent.message)).toBeVisible();
  // the buyer's brief bar is not on the seller's page
  await expect(page.getByRole("region", { name: "خلاصه خرید" })).toBeHidden();

  await page.getByRole("button", { name: "موجود است" }).click();
  await page.getByLabel("قیمت امروز به تومان").fill("۳۴۰۰۰۰۰");
  await page.getByRole("button", { name: "قیمت امروز: ۳٬۴۰۰٬۰۰۰" }).click();
  await page.getByLabel("نگه داشتن تا ساعت").fill("17:00");
  await page.getByRole("button", { name: "تا ساعت ... نگه می‌دارم" }).click();
  await page.getByRole("button", { name: "اقساط و ترب‌پی قبول می‌کنم" }).click();
  await page.getByLabel("پاسخ آزاد").fill("فردا هم داریم");
  await page.getByRole("button", { name: "ارسال" }).click();
  await expect.poll(() => replies.length).toBe(5);
  expect(replies).toEqual([
    { available: "yes" },
    { latest_price_toman: 3400000 },
    { hold_until: "17:00" },
    { installments: true },
    { text: "فردا هم داریم" },
  ]);
  expect(await noOverflow(page)).toBe(0);
});
