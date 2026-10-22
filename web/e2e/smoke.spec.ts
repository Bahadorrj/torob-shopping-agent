import { expect, test } from "@playwright/test";

test("home renders at 360 px without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "پاساژگرد" })).toBeVisible();
  await expect(page.getByLabel("خرید شما در یک جمله")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
