import { expect, test, type Page } from "@playwright/test";

import { fakeSessions } from "./fake-session";

const back = (page: Page) => page.getByRole("banner").getByRole("link", { name: "بازگشت" });
const ROUTES = [
  "/search",
  "/products/p1/sellers",
  "/products/p1/sellers/compare?offer=o1&offer=o2",
  "/compare?ids=p1,p2",
  "/shops/shop_a",
  "/pasajs/%D8%B9%D9%84%D8%A7%D8%A7%D9%84%D8%AF%DB%8C%D9%86",
  "/plan",
  "/basket?text=a",
  "/console/shop_a?token=t",
];

test("every secondary route opened directly has a back button at the header's start that goes home at 360 px", async ({ page }) => {
  await fakeSessions(page, {});
  // a shared link: no earlier page of the app to step back to
  await page.goto("/shops/shop_a");
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);

  for (const route of ROUTES) {
    await page.goto(route);
    const box = (await back(page).boundingBox())!;
    // start of the header is the right edge in RTL
    expect(box.x + box.width, route).toBeGreaterThan(360 - 64);
    await expect(back(page).locator("svg.lucide-arrow-right"), route).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBeLessThanOrEqual(360);
  }
});

test("back on a screen opened from home goes back through history", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/");
  await page.getByRole("link", { name: "جستجو" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/$/);
  // a history step, not a new entry: forward returns to search
  await page.goForward();
  await expect(page).toHaveURL(/\/search$/);
});

test("browser back closes the agent drawer on a secondary route and keeps the page", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/shops/shop_a");
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  const sheet = page.getByRole("region", { name: "دستیار" });
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/shops\/shop_a$/);
  await expect(page.getByRole("button", { name: "دستیار خرید" })).toBeVisible();

  // closing from the UI drops its history entry, so the next back leaves the page
  await page.goto("/");
  await page.goto("/shops/shop_a");
  await page.getByRole("button", { name: "دستیار خرید" }).click();
  await sheet.getByRole("button", { name: "بستن" }).click();
  await expect(sheet).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test("browser back closes chat history and stays on home", async ({ page }) => {
  await fakeSessions(page, {});
  await page.goto("/");
  await page.getByRole("region", { name: "دستیار" }).getByRole("button", { name: "تاریخچه" }).click();
  const history = page.getByRole("dialog", { name: "تاریخچه" });
  await expect(history).toBeVisible();
  await page.goBack();
  await expect(history).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});
