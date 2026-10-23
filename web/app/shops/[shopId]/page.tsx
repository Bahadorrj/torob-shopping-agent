import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { ShopDetails } from "@/components/shop-details";

export default function ShopPage({ params }: PageProps<"/shops/[shopId]">) {
  return (
    <>
      <BackHeader title="فروشگاه" />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {params.then(({ shopId }) => (
            <ShopDetails shopId={shopId} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
