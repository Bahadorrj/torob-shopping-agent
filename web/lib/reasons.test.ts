import assert from "node:assert/strict";
import { test } from "node:test";

import type { Brief, ProductCard, Reason, SellerRow } from "./api.ts";
import { productReasons, sellerReasons } from "./reasons.ts";

const reason = (kind: Reason["kind"], extra: Partial<Reason> = {}): Reason => ({ kind, months: null, provider: null, ...extra });

const seller = (reasons: Reason[], extra: Partial<SellerRow> = {}) =>
  ({ reasons, pasaj: null, payment_options: [], ...extra }) as SellerRow;

const brief = (extra: Partial<Brief> = {}) =>
  ({ priority: "most_reliable", payment: { kind: "any", provider: null }, ...extra }) as Brief;

// one row with the reason under test beside a bare row, so the reason is not shared
const one = (row: SellerRow, b = brief()) => sellerReasons([row, seller([])], b)[0];

test("seller rows: each rule of the table", () => {
  assert.equal(one(seller([reason("cheapest"), reason("warranty", { months: 18 })])), "ارزان‌ترین");
  assert.equal(one(seller([reason("closest"), reason("open_now")])), "نزدیک‌ترین");
  assert.equal(one(seller([reason("open_now"), reason("fresh_price")])), "الان باز");
  const pay = seller([reason("installments", { provider: "ترب‌پی" }), reason("warranty", { months: 18 })], {
    payment_options: [{ provider: "ترب‌پی", channel: "in_person" }],
  });
  assert.equal(one(pay, brief({ payment: { kind: "torob_pay", provider: null } })), "ترب‌پی حضوری");
  assert.equal(one(pay, brief({ payment: { kind: "installment", provider: null } })), "ترب‌پی حضوری");
  assert.equal(one(pay), "گارانتی ۱۸ ماهه", "installments counts only when the brief asks for it");
  assert.equal(one(seller([reason("fresh_price"), reason("declared_hours")])), "قیمت این هفته");
  assert.equal(one(seller([reason("declared_hours")], { pasaj: "علاءالدین" })), "ساعت کاری مشخص");
  assert.equal(one(seller([], { pasaj: "علاءالدین 2" })), "پاساژ علاءالدین ۲");
  assert.equal(one(seller([])), "فروشنده این کالا");
});

test("seller rows: the brief's priority moves its reason first", () => {
  const row = seller([reason("cheapest"), reason("closest")]);
  assert.equal(one(row, brief({ priority: "cheapest" })), "ارزان‌ترین");
  assert.equal(one(row, brief({ priority: "closest" })), "نزدیک‌ترین");
  assert.equal(one(row, brief({ priority: "most_reliable" })), "ارزان‌ترین");
});

test("seller rows: a reason every row shares is skipped", () => {
  const rows = [
    seller([reason("cheapest"), reason("open_now")], { pasaj: "علاءالدین" }),
    seller([reason("open_now"), reason("fresh_price")], { pasaj: "علاءالدین" }),
    seller([reason("open_now")], { pasaj: "علاءالدین" }),
  ];
  assert.deepEqual(sellerReasons(rows, brief()), ["ارزان‌ترین", "قیمت این هفته", "فروشنده این کالا"]);
  assert.deepEqual(sellerReasons([rows[2]], brief()), ["الان باز"], "a lone row shares nothing");
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
