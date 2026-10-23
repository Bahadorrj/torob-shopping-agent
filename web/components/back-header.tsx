"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";

// back through history when the previous entry is this app's page, else home (a shared link, a new tab)
export function BackButton() {
  const router = useRouter();
  return (
    <Link
      href="/"
      aria-label="بازگشت"
      className={buttonVariants({ variant: "ghost", size: "icon" })}
      onClick={(e) => {
        // the Navigation API only lists this origin's entries; without it, no history step is trusted
        const nav = (window as { navigation?: { canGoBack: boolean } }).navigation;
        if (!nav?.canGoBack) return;
        e.preventDefault();
        router.back();
      }}
    >
      <ArrowRight />
    </Link>
  );
}

// the app bar of every screen past home: back at its start, then the page's own content
export function BackHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b border-hairline bg-card">
      <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4">
        <BackButton />
        {children}
      </div>
    </header>
  );
}
