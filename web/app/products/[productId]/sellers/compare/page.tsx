import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { FilterChipBar } from "@/components/brief-bar";
import { SellerCompare } from "@/components/seller-compare";

export default function SellerComparePage({ params, searchParams }: PageProps<"/products/[productId]/sellers/compare">) {
  return (
    <>
      <BackHeader title="مقایسه فروشنده‌ها" />
      <FilterChipBar />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {Promise.all([params, searchParams]).then(([{ productId }, { offer }]) => (
            <SellerCompare productId={productId} offerIds={[offer ?? []].flat()} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
