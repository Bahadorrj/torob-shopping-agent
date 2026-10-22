import { expect, test } from "@playwright/test";

import { fakeSessions } from "./fake-session";

const list = "سیم افشان ۲.۵ خراسان ۲ حلقه\nمحافظ برق ۱۶ آمپر\nکلید مینیاتوری ۱۶\nزززز";

const basket = {
  items: [
    { line: "سیم افشان ۲.۵ خراسان ۲ حلقه", product_id: "p_cable", title: "سیم افشان 1*2.5 خراسان", category: "سیم و کابل", quantity: 200, unit: "meter" },
    { line: "محافظ برق ۱۶ آمپر", product_id: null, title: null, category: "سیم سیار و چندراهی برق", quantity: 1, unit: "piece" },
    { line: "کلید مینیاتوری ۱۶", product_id: "p_breaker", title: "کلید مینیاتوری هیوندای ۱۶ آمپر", category: "کلید", quantity: 1, unit: "piece" },
    { line: "زززز", product_id: null, title: null, category: null, quantity: 1, unit: "piece" },
  ],
  stops: [
    {
      shop_id: "shop_a",
      shop_name: "فرین رامورا",
      address: "خیابان لاله زار جنوبی، پاساژ ایران، طبقه دوم جنوبی",
      pasaj: "ایران",
      floor: null,
      unit: null,
      items: [
        { item: 0, offer_id: "o1", price_toman: 28000, per_meter: true, total_toman: 5600000, trust_level: "listed" },
        { item: 2, offer_id: "o2", price_toman: 185000, per_meter: false, total_toman: 185000, trust_level: "listed" },
      ],
      total_toman: 5785000,
    },
    {
      shop_id: "shop_b",
      shop_name: "نیآرا نییس",
      address: "خیابان لاله زار جنوبی، کوچه بوشهری",
      pasaj: null,
      floor: null,
      unit: null,
      items: [{ item: 1, offer_id: null, price_toman: null, per_meter: false, total_toman: null, trust_level: "category_only" }],
      total_toman: 0,
    },
  ],
  missing: [3],
  total_toman: 5785000,
};

test("a pasted list opens basket mode: stops, per-meter totals, category-only flag, missing items, then the plan at 360 px", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.69, longitude: 51.42 });
  await fakeSessions(page, {});
  const sent: string[] = [];
  await page.route("**/api/basket", (route) => {
    sent.push(route.request().postDataJSON().text);
    return route.fulfill({ json: basket });
  });
  await page.route("**/api/visit-plan**", (route) => route.abort());
  await page.goto("/");

  await page.getByLabel("خرید شما در یک جمله").evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, list);

  await expect(page.getByRole("heading", { name: "فهرست خرید" })).toBeVisible();
  await expect(page.getByText("۲ توقف")).toBeVisible();
  expect(sent).toEqual([list]);

  const stops = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) });
  await expect(stops).toHaveCount(2);
  await expect(stops.nth(0)).toContainText("قیمت هر متر ۲۸٬۰۰۰ تومان، جمع ۵٬۶۰۰٬۰۰۰ تومان");
  await expect(stops.nth(0)).toContainText("(۲۰۰ متر)");
  await expect(stops.nth(1)).toContainText("فقط دسته‌بندی فروشگاه");
  await expect(page.getByRole("region", { name: "پیدا نشد" })).toContainText("زززز");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

  await page.getByRole("button", { name: "برنامه مراجعه" }).click();
  await expect(page).toHaveURL(/\/plan\?shop_id=shop_a&shop_id=shop_b&lat=35.69&lon=51.42&mode=walk/);
});
