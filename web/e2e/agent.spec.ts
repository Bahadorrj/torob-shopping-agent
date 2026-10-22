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
