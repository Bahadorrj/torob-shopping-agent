"use client";

import { cn } from "cn";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { buttonVariants } from "@/components/ui/button";

// back through history when the previous entry is this app's page, else home (a shared link, a new tab)
export function BackButton() {
  const router = useRouter();
  return (
    <Link
      href="/"
      aria-label="بازگشت"
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11 shrink-0")}
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

const TITLE_ID = "page-title";
const TITLE = "truncate text-base font-bold";

// the app bar of every screen past home: back at its start, the page title, then the page's own content.
// `title` shows until the page puts its loaded title in with PageTitle
export function BackHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="border-b border-hairline bg-card">
      <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4">
        <BackButton />
        <div id={TITLE_ID} className="min-w-0 flex-1">
          <h1 className={cn(TITLE, "[&:not(:only-child)]:hidden")}>{title}</h1>
        </div>
        {children}
      </div>
    </header>
  );
}

const noSubscribe = () => () => {};

// puts a title the page loaded into the BackHeader in place of its generic one
export function PageTitle({ children }: { children: React.ReactNode }) {
  const slot = useSyncExternalStore(noSubscribe, () => document.getElementById(TITLE_ID), () => null);
  return slot && createPortal(<h1 className={TITLE}>{children}</h1>, slot);
}
