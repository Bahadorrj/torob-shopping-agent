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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  await sheet.getByRole("button", { name: "فردوسی" }).click();
  await expect(sheet.getByText("فردوسی", { exact: true }).first()).toBeVisible();
  await expect(sheet.getByText("این هدفون را پیدا کردم.")).toHaveCount(2);
});
