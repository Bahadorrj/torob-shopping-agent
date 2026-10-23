"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { BackButton } from "@/components/back-header";
import { FilterChipBar } from "@/components/brief-bar";
import { CategoryTiles, PasajList } from "@/components/home-start";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchProducts, type ProductCard as Product } from "@/lib/api";
import { productReasons } from "@/lib/reasons";

// product search, the alternative to the assistant on home
export default function SearchPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Product[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function search(text: string) {
    if (!text.trim()) return;
    setQ(text);
    try {
      setItems(await searchProducts(text));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  const reasons = items ? productReasons(items) : [];
  return (
    <>
      <header className="border-b border-hairline bg-card">
        <form
          className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4"
          onSubmit={(e) => {
            e.preventDefault();
            search(q);
          }}
        >
          <BackButton />
          <h1 className="shrink-0 text-base font-bold">جستجو</h1>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام کالا یا مدل" aria-label="جستجوی کالا" className="h-10 min-w-0 flex-1" />
          <Button type="submit" variant="buy" size="icon" aria-label="جستجو کن" className="size-10 shrink-0">
            <Search />
          </Button>
        </form>
      </header>
      <FilterChipBar />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-4">
        {failed && <p className="text-sm">جستجو انجام نشد. دوباره امتحان کنید.</p>}
        {items && (
          <section aria-label="نتیجه‌ها">
            {items.length ? (
              <ul className="flex flex-col gap-2">
                {items.map((p, i) => (
                  <li key={p.product_id}>
                    <ProductCard product={p} reason={reasons[i]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">کالایی پیدا نشد.</p>
            )}
          </section>
        )}
        <CategoryTiles onPick={search} />
        <PasajList />
        <p className="rounded-xl bg-card p-4 text-xs leading-5">داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.</p>
      </main>
    </>
  );
}
