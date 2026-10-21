import { expect, test, type Page } from "@playwright/test";

const declared = (start: string, end: string) => ({ status: "declared", shifts: [{ start, end }] });
const days = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

const known = {
  shop_id: "shop_known",
  name: "ویسا رویلا",
  address: "خیابان جمهوری اسلامی، نبش خیابان شیخ هادی، مجتمع علاالدین ۲، طبقه ۳، واحد ۳۲۷",
  pasaj: "علاالدین 2",
  floor: "۳",
  unit: "۳۲۷",
  landmark: "نبش خیابان شیخ هادی",
  hours: {
    timezone: "Asia/Tehran",
    today: "wed",
    week: days.map((day) =>
      day === "fri"
        ? { day, status: "closed", shifts: [] }
        : day === "sun"
          ? { day, status: "declared", shifts: [{ start: "09:30", end: "13:00" }, { start: "16:00", end: "20:00" }] }
          : { day, ...declared("09:30", "18:30") },
    ),
  },
  payment_options: [
    { provider: "اسنپ‌پی", channel: "in_person" },
    { provider: "ترب‌پی", channel: "unknown" },
  ],
  fast_delivery: "yes",
  website_url: "https://example.ir/",
  instagram_url: "https://www.instagram.com/example/",
};

const unknown = {
  ...known,
  shop_id: "shop_unknown",
  name: "آریلا مانوان",
  address: null,
  pasaj: null,
  floor: null,
  unit: null,
  landmark: null,
  hours: { ...known.hours, week: days.map((day) => ({ day, status: "unknown", shifts: [] })) },
  payment_options: [],
  fast_delivery: "unknown",
  website_url: null,
  instagram_url: null,
};

async function open(page: Page, shop: { shop_id: string; name: string }) {
  await page.route(`**/api/shops/${shop.shop_id}`, (route) => route.fulfill({ json: shop }));
  await page.goto(`/shops/${shop.shop_id}`);
  await expect(page.getByRole("heading", { name: shop.name })).toBeVisible();
}

function row(page: Page, label: string) {
  return page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
}

test("shop page shows location, hours, payment, delivery and links at 360 px", async ({ page }) => {
  await open(page, known);
  await expect(row(page, "پاساژ")).toContainText("علاالدین ۲");
  await expect(row(page, "طبقه")).toContainText("۳");
  await expect(row(page, "واحد")).toContainText("۳۲۷");
  await expect(page.getByText(known.address)).toBeVisible();

  await expect(row(page, "امروز")).toContainText("۰۹:۳۰ تا ۱۸:۳۰");
  await expect(row(page, "یکشنبه")).toContainText("۰۹:۳۰ تا ۱۳:۰۰، ۱۶:۰۰ تا ۲۰:۰۰");
  await expect(row(page, "جمعه")).toContainText("تعطیل");

  await expect(page.getByRole("listitem").filter({ hasText: "اسنپ‌پی" })).toContainText("پرداخت حضوری");
  await expect(page.getByRole("listitem").filter({ hasText: "ترب‌پی" })).toContainText("نحوه پرداخت ثبت نشده");
  await expect(row(page, "ارسال سریع")).toContainText("دارد");
  await expect(page.getByRole("link", { name: "وب‌سایت" })).toHaveAttribute("href", known.website_url);
  await expect(page.getByRole("link", { name: "اینستاگرام" })).toHaveAttribute("href", known.instagram_url);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});

test("unknown shop fields read 'not recorded', never blank", async ({ page }) => {
  await open(page, unknown);
  for (const label of ["پاساژ", "طبقه", "واحد", "امروز", "شنبه", "پرداخت", "ارسال سریع"]) {
    await expect(row(page, label)).toContainText("ثبت نشده");
  }
  await expect(page.getByRole("link", { name: "وب‌سایت" })).toHaveCount(0);
});
