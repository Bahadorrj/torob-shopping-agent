import Link from "next/link";

import { TrayToggle } from "@/components/compare-tray";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PriceFlag, PriceRange, ProductCard as Product } from "@/lib/api";
import { faDigits, fromToman, priceAge, toman, UNKNOWN } from "@/lib/format";
import { productReasons } from "@/lib/reasons";

const FLAG_LABELS: Partial<Record<PriceFlag, string>> = {
  placeholder: "قیمت صوری کنار گذاشته شد",
  invalid: "قیمت نامعتبر کنار گذاشته شد",
  far_from_median: "قیمت دور از میانه کنار گذاشته شد",
};

const range = (min: number, max: number) => (min === max ? toman(min) : fromToman(min));

// a listed price range with its trust level and age, else "not recorded"
export function ListedPrice({ price }: { price: PriceRange }) {
  if (price.trust_level !== "listed" || price.min_toman === null || price.max_toman === null) {
    return <span className="text-sm text-muted-foreground">قیمت ثبت نشده</span>;
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-bold">{range(price.min_toman, price.max_toman)}</span>
        {price.per_meter && <Badge variant="outline">قیمت هر متر</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="secondary">قیمت ثبت‌شده</Badge>
        <span>آخرین تغییر قیمت: {priceAge(price.price_age_days)}</span>
        {price.price_age_bucket === ">30" && <span className="text-amber-700">قیمت قدیمی، استعلام بگیرید</span>}
      </div>
    </>
  );
}

// one line: the lowest listed price, or unknown; its age differs per seller, so it is not shown here
function FromPrice({ price }: { price: PriceRange }) {
  if (price.trust_level !== "listed" || price.min_toman === null) return <p className="text-sm text-muted-foreground">قیمت: {UNKNOWN}</p>;
  return (
    <p className="text-sm font-bold tabular-nums">
      {fromToman(price.min_toman)}
      {price.per_meter && " هر متر"}
    </p>
  );
}

// `reason` comes from comparing the cards of one block; alone, a card is compared with itself
export function ProductCard({ product, reason }: { product: Product; reason?: string }) {
  const { price } = product;
  const notes = product.price_flags.flatMap((f) => FLAG_LABELS[f] ?? []);
  if (product.price_flags.includes("missing") && price.trust_level === "listed") notes.push("برخی فروشنده‌ها قیمت ثبت نکرده‌اند");
  if (product.price_flags.includes("per_meter") && !price.per_meter) notes.push("برخی قیمت‌ها هر متر است");

  return (
    // the sellers link stretches over the whole card; the compare toggle sits above it
    <Card className="relative flex-row gap-3 p-3">
      <div className="size-[72px] shrink-0 overflow-hidden rounded-lg bg-card">
        {product.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt="" loading="lazy" className="size-full object-contain" />
        )}
      </div>
      <CardContent className="flex min-w-0 flex-1 flex-col items-start gap-1 p-0">
        <Badge variant="secondary" className="rounded-full font-bold">
          {reason ?? productReasons([product])[0]}
        </Badge>
        <h2 className="line-clamp-2 text-sm font-bold leading-6">{product.title}</h2>
        <FromPrice price={price} />
        <p className="text-xs text-muted-foreground tabular-nums">در {faDigits(product.offer_count)} فروشگاه</p>
        {notes.length > 0 && <p className="text-xs text-muted-foreground">{notes.join("، ")}</p>}
        <div className="flex w-full items-center justify-between gap-2 text-sm">
          {product.offer_count > 0 ? (
            <Link href={`/products/${product.product_id}/sellers`} className="font-bold text-contact after:absolute after:inset-0">
              دیدن فروشنده‌ها
            </Link>
          ) : (
            <span />
          )}
          <span className="relative z-10">
            <TrayToggle item={{ product_id: product.product_id, title: product.title }} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
