import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PriceFlag, ProductCard as Product } from "@/lib/api";
import { faDigits, priceAge, toman } from "@/lib/format";

const FLAG_LABELS: Partial<Record<PriceFlag, string>> = {
  placeholder: "قیمت صوری کنار گذاشته شد",
  invalid: "قیمت نامعتبر کنار گذاشته شد",
  far_from_median: "قیمت دور از میانه کنار گذاشته شد",
};

export function ProductCard({ product }: { product: Product }) {
  const { price } = product;
  const notes = product.price_flags.flatMap((f) => FLAG_LABELS[f] ?? []);
  if (product.price_flags.includes("missing") && price.trust_level === "listed") notes.push("برخی فروشنده‌ها قیمت ثبت نکرده‌اند");
  if (product.price_flags.includes("per_meter") && !price.per_meter) notes.push("برخی قیمت‌ها هر متر است");

  return (
    <Card className="flex-row gap-3 p-3">
      {product.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image_url} alt="" loading="lazy" className="size-20 shrink-0 rounded-md bg-muted object-contain" />
      ) : (
        <div className="size-20 shrink-0 rounded-md bg-muted" />
      )}
      <CardContent className="flex min-w-0 flex-1 flex-col gap-1.5 p-0">
        <h2 className="line-clamp-2 text-sm font-semibold leading-6">{product.title}</h2>
        {product.key_specs.length > 0 && (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {product.key_specs.map((s) => `${s.key}: ${s.value}`).join(" · ")}
          </p>
        )}
        {price.trust_level === "listed" && price.min_toman !== null && price.max_toman !== null ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-bold">{toman(price.min_toman, price.max_toman)}</span>
              {price.per_meter && <Badge variant="outline">قیمت هر متر</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary">قیمت ثبت‌شده</Badge>
              <span>{priceAge(price.price_age_days)}</span>
              {price.price_age_bucket === ">30" && <span className="text-amber-700">قیمت قدیمی، استعلام بگیرید</span>}
            </div>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">قیمت ثبت نشده</span>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{faDigits(product.offer_count)} فروشنده</span>
          {product.offer_count > 0 && (
            <Link href={`/products/${product.product_id}/sellers`} className="font-medium text-primary underline-offset-4 hover:underline">
              دیدن فروشنده‌ها
            </Link>
          )}
          {notes.map((n) => (
            <Badge key={n} variant="outline" className="text-muted-foreground">
              {n}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
