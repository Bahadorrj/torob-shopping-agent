import { Search } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

// agent-first home: the app bar here, the assistant's thread inline below it (AgentSheet in the layout)
export default function Home() {
  return (
    <header className="border-b border-hairline bg-card">
      <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-base font-bold text-brand-foreground" aria-hidden>
          پ
        </span>
        <h1 className="flex-1 text-base font-bold">پاساژگرد</h1>
        <Link href="/search" aria-label="جستجو" className={buttonVariants({ variant: "ghost", size: "icon" })}>
          <Search />
        </Link>
      </div>
    </header>
  );
}
