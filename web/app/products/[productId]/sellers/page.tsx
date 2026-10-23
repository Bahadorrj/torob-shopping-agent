import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { FilterChipBar } from "@/components/brief-bar";
import { SellerList } from "@/components/seller-list";

export default function SellersPage({ params }: PageProps<"/products/[productId]/sellers">) {
  return (
    <>
      <BackHeader />
      <FilterChipBar />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-4">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {params.then(({ productId }) => (
            <SellerList productId={productId} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
