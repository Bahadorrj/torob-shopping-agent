import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { SellerConsole } from "@/components/seller-console";

export default function ConsolePage({ params, searchParams }: PageProps<"/console/[shopId]">) {
  return (
    <>
      <BackHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {Promise.all([params, searchParams]).then(([{ shopId }, { token }]) => (
            <SellerConsole shopId={shopId} token={[token].flat()[0] ?? ""} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
