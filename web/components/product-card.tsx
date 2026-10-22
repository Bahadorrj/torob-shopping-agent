import Link from "next/link";

import { TrayToggle } from "@/components/compare-tray";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PriceFlag, PriceRange, ProductCard as Product } from "@/lib/api";
import { faDigits, faText, fromToman, priceAge, toman } from "@/lib/format";

const FLAG_LABELS: Partial<Record<PriceFlag, string>> = {
  placeholder: "قیمت صوری کنار گذاشته شد",
  invalid: "قیمت نامعتبر کنار گذاشته شد",
  far_from_median: "قیمت دور از میانه کنار گذاشته شد",
};

function joinFa(words: string[]) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join("، ")} و ${words.at(-1)}`;
}

// one sentence from the card's own data, so it claims nothing the search did not return
const range = (min: number, max: number) => (min === max ? toman(min) : fromToman(min));

function whySentence(p: Product) {
  const words = p.score_parts.filter((s) => s.matched).map((s) => `«${faText(s.word)}»`);
  const found =
    words.length > 0
      ? `${joinFa(words)} در نام، برند یا مدل این کالا آمده و `
      : p.meaning_match
        ? "این کالا از نظر معنا به جستجوی شما نزدیک است و "
        : "";
  if (p.offer_count === 0) return `${found}فروشنده‌ای آن را ثبت نکرده است.`;
  const { price } = p;
  const priced =
    price.trust_level === "listed" && price.min_toman !== null && price.max_toman !== null
      ? `با قیمت ${range(price.min_toman, price.max_toman)}${price.per_meter ? " برای هر متر" : ""}`
      : "بدون قیمت";
  return `${found}${faDigits(p.offer_count)} فروشنده آن را ${priced} ثبت کرده‌اند.`;
}

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
        <ListedPrice price={price} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{faDigits(product.offer_count)} فروشنده</span>
          {notes.map((n) => (
            <Badge key={n} variant="outline" className="text-muted-foreground">
              {n}
            </Badge>
          ))}
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-primary">چرا این؟</summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {product.meaning_match && <Badge variant="secondary">هم‌معنا با جستجو</Badge>}
              {product.score_parts.map((s) =>
                s.matched ? (
                  <Badge key={s.word} variant="secondary">مطابق: {faText(s.word)}</Badge>
                ) : (
                  <Badge key={s.word} variant="outline" className="text-muted-foreground">
                    نیامده: {faText(s.word)}
                  </Badge>
                ),
              )}
            </div>
            <p className="leading-6">{whySentence(product)}</p>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <TrayToggle item={{ product_id: product.product_id, title: product.title }} />
          {product.offer_count > 0 && (
            <Link href={`/products/${product.product_id}/sellers`} className="font-medium text-primary underline-offset-4 hover:underline">
              دیدن فروشنده‌ها
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
