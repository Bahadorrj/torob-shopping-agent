import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProductCard, Reason, SellerRow } from "./api.ts";
import { productReasons, productWhy, sellerChips } from "./reasons.ts";

const reason = (kind: Reason["kind"], extra: Partial<Reason> = {}): Reason => ({ kind, months: null, provider: null, ...extra });

const seller = (reasons: Reason[], extra: Partial<SellerRow> = {}) =>
  ({ reasons, pasaj: null, payment_options: [], ...extra }) as SellerRow;

test("seller chips: every reason, in a fixed order", () => {
  const row = seller(
    [reason("declared_hours"), reason("warranty", { months: 18 }), reason("installments", { provider: "ترب‌پی" }), reason("open_now"), reason("closest"), reason("cheapest"), reason("fresh_price")],
    { payment_options: [{ provider: "ترب‌پی", channel: "in_person" }] },
  );
  assert.deepEqual(sellerChips(row), ["ارزان‌ترین", "نزدیک‌ترین", "الان باز", "ترب‌پی حضوری", "گارانتی ۱۸ ماهه", "قیمت این هفته", "ساعت کاری مشخص"]);
  assert.deepEqual(sellerChips(seller([reason("installments", { provider: "تارا" })])), ["تارا"]);
  assert.deepEqual(sellerChips(seller([reason("warranty")])), ["گارانتی"]);
});

test("seller chips: a row without reasons names its pasaj, else the product", () => {
  assert.deepEqual(sellerChips(seller([], { pasaj: "علاءالدین 2" })), ["پاساژ علاءالدین ۲"]);
  assert.deepEqual(sellerChips(seller([])), ["فروشنده این کالا"]);
});

const price = { trust_level: "listed", min_toman: null, max_toman: null, per_meter: false, last_price_changed_at: null, price_age_days: null, price_age_bucket: null };
const card = (extra: Partial<ProductCard> & { min?: number | null; bucket?: ProductCard["price"]["price_age_bucket"] } = {}) => {
  const { min = null, bucket = null, ...rest } = extra;
  return {
    offer_count: 1, score_parts: [], meaning_match: false, ...rest,
    price: { ...price, min_toman: min, max_toman: min, price_age_bucket: bucket },
  } as unknown as ProductCard;
};

test("product cards: each rule of the table", () => {
  assert.deepEqual(productReasons([card({ min: 100 }), card({ min: 200 })]).slice(0, 1), ["ارزان‌ترین"]);
  assert.deepEqual(productReasons([card({ min: 100 })]), ["در ۱ فروشگاه"], "cheapest needs 2 priced cards");
  assert.deepEqual(productReasons([card({ offer_count: 3 }), card({ offer_count: 2 })]), ["بیشترین فروشنده", "در ۲ فروشگاه"]);
  assert.deepEqual(productReasons([card({ offer_count: 2 }), card({ offer_count: 1 })]), ["در ۲ فروشگاه", "در ۱ فروشگاه"], "needs 3 offers");
  assert.deepEqual(productReasons([card({ bucket: "<=7" }), card()]), ["قیمت این هفته", "در ۱ فروشگاه"]);
  const words = [{ word: "a", matched: true }, { word: "b", matched: true }];
  assert.deepEqual(productReasons([card({ score_parts: words }), card({ score_parts: [words[0], { word: "b", matched: false }] })]), ["مطابق جستجو", "در ۱ فروشگاه"]);
  assert.deepEqual(productReasons([card({ meaning_match: true }), card()]), ["هم‌معنا با جستجو", "در ۱ فروشگاه"]);
  assert.deepEqual(productReasons([card({ offer_count: 12 })]), ["در ۱۲ فروشگاه"]);
});

test("product cards: a reason every card shares is skipped", () => {
  assert.deepEqual(productReasons([card({ meaning_match: true, bucket: "<=7" }), card({ meaning_match: true })]), ["قیمت این هفته", "در ۱ فروشگاه"]);
});

test("product why: chips and the sentence come from the score parts", () => {
  const parts = [{ word: "هدفون", matched: true }, { word: "انکر", matched: true }, { word: "قرمز", matched: false }];
  assert.deepEqual(productWhy(card({ score_parts: parts, meaning_match: true, offer_count: 8 })), {
    chips: ["«هدفون» در عنوان یا برند", "«انکر» در عنوان یا برند", "«قرمز» پیدا نشد", "هم‌معنا با جستجو"],
    sentence: "«هدفون» و «انکر» در عنوان یا برند این کالا هست؛ «قرمز» در آن پیدا نشد؛ از نظر معنی به جستجوی شما نزدیک است؛ ۸ فروشگاه آن را دارند.",
  });
  assert.deepEqual(productWhy(card()), { chips: [], sentence: "۱ فروشگاه آن را دارند." });
});
