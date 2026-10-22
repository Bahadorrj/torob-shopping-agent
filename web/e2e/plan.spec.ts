import { expect, test, type Page } from "@playwright/test";

import { emptyBrief, fakeSessions } from "./fake-session";

const links = (lat: number, lon: number) => ({
  neshan: `https://nshn.ir/?origin=35.69,51.42&destination=${lat},${lon}&vehicle=d`,
  balad: `https://balad.ir/location?latitude=${lat}&longitude=${lon}&zoom=18`,
  google: `https://www.google.com/maps/dir/?api=1&origin=35.69,51.42&destination=${lat},${lon}&travelmode=walking`,
});

const stop = (shop_id: string, shop_name: string, extra: object) => ({
  shop_id,
  shop_name,
  lat: 35.6949,
  lon: 51.4115,
  route: { distance_m: 1000, duration_min: 10, source: "neshan" },
  links: links(35.6949, 51.4115),
  last_leg: { pasaj: "علاالدین", landmark: "رو‌به‌روی پاساژ چهارسو", floor: "۲", unit: "۲۱۶" },
  eta: "2026-10-22T13:45:00+03:30",
  open_at_eta: true,
  inquiry: null,
  ...extra,
});

const plan = {
  origin: { lat: 35.69, lon: 51.42 },
  depart_at: "2026-10-22T13:35:00+03:30",
  mode: "walk",
  stops: [
    stop("shop_a", "آذرنوش دیسیس", {}),
    stop("shop_b", "دیسورا پاکیار", {
      route: { distance_m: 40, duration_min: 1, source: "straight_line" },
      last_leg: { pasaj: "علاالدین", landmark: null, floor: "5", unit: "506" },
      eta: "2026-10-22T14:01:00+03:30",
      open_at_eta: false,
    }),
    stop("shop_c", "روین فریسا", {
      lat: 35.6965,
      lon: 51.4244,
      route: { distance_m: 1200, duration_min: 16, source: "straight_line" },
      links: links(35.6965, 51.4244),
      last_leg: { pasaj: null, landmark: null, floor: null, unit: null },
      eta: "2026-10-22T14:32:00+03:30",
      open_at_eta: null,
    }),
  ],
};

const query = "shop_id=shop_c&shop_id=shop_a&shop_id=shop_b&lat=35.69&lon=51.42&mode=walk&depart_at=2026-10-22T13%3A35%3A00%2B03%3A30";

async function fakePlan(page: Page) {
  const requests: string[] = [];
  await page.route("**/api/visit-plan?**", (route) => {
    requests.push(new URL(route.request().url()).search.slice(1));
    return route.fulfill({ json: plan });
  });
  return requests;
}

const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("visit plan shows a map and a timeline of stops with open status, routes and map-app links at 360 px", async ({ page }) => {
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await fakeSessions(page, {});
  const requests = await fakePlan(page);
  await page.goto(`/plan?${query}`);

  await expect(page.getByRole("heading", { name: "برنامه مراجعه" })).toBeVisible();
  // the page asks for exactly the plan in its link
  expect(requests).toEqual([query]);

  const stops = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "صفحه فروشگاه" }) });
  await expect(stops).toHaveCount(3);
  const [a, b, c] = [stops.nth(0), stops.nth(1), stops.nth(2)];
  await expect(a).toContainText("آذرنوش دیسیس");
  await expect(a).toContainText("رسیدن ۱۳:۴۵");
  await expect(a).toContainText("باز در زمان رسیدن");
  await expect(a).toContainText("۱ کیلومتر، ۱۰ دقیقه");
  await expect(a).toContainText("پاساژ علاالدین، رو‌به‌روی پاساژ چهارسو، طبقه ۲، واحد ۲۱۶");
  await expect(b).toContainText("بسته در زمان رسیدن");
  await expect(b).toContainText("پاساژ علاالدین، طبقه ۵، واحد ۵۰۶");
  await expect(c).toContainText("ساعت کاری ثبت نشده");
  await expect(c).toContainText("۱٫۲ کیلومتر، ۱۶ دقیقه (تخمین خط مستقیم)");
  await expect(c).toContainText("طبقه و واحد ثبت نشده");

  for (const [name, key] of [["نشان", "neshan"], ["بلد", "balad"], ["گوگل مپ", "google"]] as const) {
    await expect(c.getByRole("link", { name: `باز کردن در ${name}` })).toHaveAttribute("href", plan.stops[2].links[key]);
  }
  // one pin per pasaj
  await expect(page.getByRole("button", { name: /روی نقشه/ })).toHaveCount(2);
  expect(await noOverflow(page)).toBe(0);
});

test("the plan is shared as a read-only link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await fakeSessions(page, {});
  await fakePlan(page);
  await page.goto(`/plan?${query}`);
  await page.getByRole("button", { name: "اشتراک‌گذاری برنامه" }).click();
  await expect(page.getByText("پیوند برنامه کپی شد")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
});

test("seller compare opens the visit plan from the brief's origin, mode and visit time", async ({ page }) => {
  const sellers = ["shop_a", "shop_b"].map((shop_id, i) => ({ offer_id: `o${i}`, shop_id, shop_name: shop_id, travel_min: null, arrival_at: "2026-10-22T17:00:00+03:30", open_at_arrival: null, payment_options: [], reasons: [], unknown: [], latest_price: { status: "not_asked" }, distance_m: null, price_toman: null, price_age_days: null, warranty: null, fast_delivery: "unknown", trust_level: "unknown" }));
  await page.route("**/api/products/p1/sellers/compare**", (r) => r.fulfill({ json: { product_id: "p1", title: "x", travel_mode: "car", travel_estimate: "straight_line", sellers } }));
  const seed = { ...emptyBrief(), origin: { lat: 35.69, lon: 51.42 }, travel_mode: "car", visit_window: { date: "2026-10-22", earliest_arrival: "17:00:00", latest_departure: null } };
  await fakeSessions(page, {}, { s9: { brief: seed } });
  await page.addInitScript(() => localStorage.setItem("pasazhgard.session", "s9"));
  await page.goto("/products/p1/sellers/compare?offer=o0&offer=o1");
  await expect(page.getByRole("link", { name: "برنامه مراجعه" })).toHaveAttribute(
    "href",
    "/plan?shop_id=shop_a&shop_id=shop_b&lat=35.69&lon=51.42&mode=car&depart_at=2026-10-22T17%3A00%3A00%2B03%3A30&session_id=s9",
  );
});

const inquiry = (status: string, extra: object = {}) => ({
  inquiry_id: 1,
  status,
  available: "unknown",
  latest_price_toman: null,
  hold_until: null,
  installments: null,
  replied_at: null,
  product_id: "p1",
  product_title: "هندزفری انکر R50i NC",
  listed_price_toman: 4_499_000,
  price_delta_toman: null,
  over_budget: false,
  ...extra,
});

// a live plan: the stream is its only source, so each leg is routed once per page load
async function fakeStream(page: Page, live: object | null) {
  const streamed: string[] = [];
  const fetched: string[] = [];
  await page.route("**/api/visit-plan?**", (route) => {
    fetched.push(new URL(route.request().url()).search.slice(1));
    return route.fulfill(live ? { json: live } : { status: 404, json: { detail: "shop or session not found" } });
  });
  await page.route("**/api/visit-plan/stream?**", (route) => {
    streamed.push(new URL(route.request().url()).search.slice(1));
    if (!live) return route.fulfill({ status: 404, json: { detail: "shop or session not found" } });
    return route.fulfill({ contentType: "text/event-stream", body: `retry: 100
data: ${JSON.stringify(live)}

` });
  });
  return { streamed, fetched };
}

test("a session's plan follows its inquiries over SSE: confirmed badge and time, price difference, over budget at 360 px", async ({ page }) => {
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await fakeSessions(page, {});
  const confirmed = inquiry("confirmed", { available: "yes", latest_price_toman: 5_200_000, price_delta_toman: 701_000, over_budget: true, replied_at: "2026-10-20T15:00:00+03:30" });
  const updated = {
    ...plan,
    stops: [
      stop("shop_a", "نیین ماهیس", { inquiry: confirmed }),
      stop("shop_b", "نیکورا ویوان", { inquiry: inquiry("closed", { inquiry_id: 2 }) }),
      // a price the seller gave without confirming stock
      stop("shop_c", "دیسیلا مانسا", { inquiry: inquiry("replied", { inquiry_id: 3, latest_price_toman: 4_000_000, price_delta_toman: -499_000 }) }),
    ],
  };
  const { streamed, fetched } = await fakeStream(page, updated);
  await page.goto(`/plan?${query}&session_id=s9`);

  const stops = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "صفحه فروشگاه" }) });
  await expect(stops).toHaveCount(3);
  expect(streamed[0]).toBe(`${query}&session_id=s9`);
  expect(fetched).toEqual([]);
  const [a, b, c] = [stops.nth(0), stops.nth(1), stops.nth(2)];
  await expect(a).toContainText("تأیید شد ساعت ۱۵:۰۰");
  await expect(a).toContainText("قیمت تأییدشده ۵٬۲۰۰٬۰۰۰ تومان، ۷۰۱٬۰۰۰ تومان گران‌تر از قیمت ثبت‌شده");
  await expect(a).toContainText("بیشتر از بودجه");
  await expect(b).toContainText("فروشگاه الان بسته است");
  await expect(b).toContainText("قیمت ثبت‌شده ۴٬۴۹۹٬۰۰۰ تومان");
  await expect(b).not.toContainText("بیشتر از بودجه");
  await expect(c).toContainText("قیمت فروشنده ۴٬۰۰۰٬۰۰۰ تومان، ۴۹۹٬۰۰۰ تومان ارزان‌تر از قیمت ثبت‌شده");
  await expect(c).not.toContainText("تأییدشده");
  expect(await noOverflow(page)).toBe(0);
});

test("a session's plan is shared without the session, which is the only key to its inquiries", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
  await fakeSessions(page, {});
  await fakeStream(page, plan);
  await page.goto(`/plan?${query}&session_id=s9`);
  await page.getByRole("button", { name: "اشتراک‌گذاری برنامه" }).click();
  await expect(page.getByText("پیوند برنامه کپی شد")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/plan?${query}`, page.url()).href);
});

test("a session's plan the server refuses to stream says why", async ({ page }) => {
  await fakeSessions(page, {});
  await fakeStream(page, null);
  await page.goto(`/plan?${query}&session_id=gone`);
  await expect(page.getByText("فروشگاه‌های این برنامه پیدا نشدند.")).toBeVisible();
});
