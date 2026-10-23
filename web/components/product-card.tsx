import { cn } from "cn";
import Link from "next/link";

import { TrayToggle } from "@/components/compare-tray";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { PriceFlag, PriceRange, ProductCard as Product } from "@/lib/api";
import { faDigits, fromToman, priceAge, toman, UNKNOWN } from "@/lib/format";
import { productReasons, productWhy } from "@/lib/reasons";

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
        {price.price_age_bucket === ">30" && <span className="text-notice-foreground">قیمت قدیمی، استعلام بگیرید</span>}
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

  const why = productWhy(product);
  const stores = `در ${faDigits(product.offer_count)} فروشگاه`;
  const badge = reason ?? productReasons([product])[0];
  return (
    // the sellers link stretches over the whole card; the compare toggle sits above it
    <Card className="relative h-full gap-2 p-3">
      {product.image_url && (
        <div data-slot="image" className="h-24 shrink-0 overflow-hidden rounded-lg bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={product.image_url} alt="" loading="lazy" className="size-full object-contain" />
        </div>
      )}
      {/* left is the end corner in RTL */}
      <span className="absolute top-1 left-1 z-10">
        <TrayToggle item={{ product_id: product.product_id, title: product.title }} />
      </span>
      <CardContent className="flex min-w-0 flex-1 flex-col items-start gap-1 p-0">
        <h2 className="line-clamp-2 pe-10 text-sm font-bold leading-6">{product.title}</h2>
        <FromPrice price={price} />
        <p className="text-xs text-muted-foreground tabular-nums">{stores}</p>
        <div className="mt-1 flex flex-col items-start gap-1 border-t pt-2">
          {/* the store-count fallback reason would repeat the meta line above */}
          {badge !== stores && (
            <Badge variant="secondary" className="rounded-full">
              {badge}
            </Badge>
          )}
          {why.chips.length > 0 && (
            <div role="group" data-slot="why" aria-label="چرا این کالا؟" className="flex flex-wrap gap-1">
              {why.chips.map((c) => (
                <Badge key={c} variant="outline" className="h-auto py-0.5 font-normal whitespace-normal text-muted-foreground">
                  {c}
                </Badge>
              ))}
            </div>
          )}
          {why.chips.length > 0 && <p className="text-xs leading-5 text-muted-foreground">{why.sentence}</p>}
          {notes.length > 0 && <p className="text-xs text-muted-foreground">{notes.join("، ")}</p>}
        </div>
      </CardContent>
      {product.offer_count > 0 && (
        <Link
          href={`/products/${product.product_id}/sellers`}
          className={cn(buttonVariants({ variant: "contact", size: "row" }), "h-11 w-full after:absolute after:inset-0")}
        >
          دیدن فروشنده‌ها
        </Link>
      )}
    </Card>
  );
}
