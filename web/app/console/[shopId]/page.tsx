import { Suspense } from "react";

import { SellerConsole } from "@/components/seller-console";

export default function ConsolePage({ params }: PageProps<"/console/[shopId]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
        {params.then(({ shopId }) => (
          <SellerConsole shopId={shopId} />
        ))}
      </Suspense>
    </main>
  );
}
