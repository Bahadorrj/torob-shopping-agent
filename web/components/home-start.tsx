"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { recentSessionIds, useBrief } from "@/components/brief-provider";
import { Button } from "@/components/ui/button";
import { getSession, type Session } from "@/lib/api";
import { locate } from "@/lib/format";

const NEAR_ME_M = 1000;

function label(s: Session) {
  return s.brief.need ?? (s.step?.kind === "sellers" ? s.step.title : null) ?? null;
}

export function NearMe() {
  const { session, patch } = useBrief();
  const [geoError, setGeoError] = useState(false);
  const on = session?.brief.area?.radius_m != null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={on ? "default" : "outline"}
        size="sm"
        aria-pressed={on}
        className="self-start"
        onClick={async () => {
          try {
            const origin = await locate();
            setGeoError(false);
            patch({ brief: { origin, area: { radius_m: NEAR_ME_M } } });
          } catch {
            setGeoError(true);
          }
        }}
      >
        نزدیک من
      </Button>
      {geoError && <p className="text-xs text-destructive">موقعیت شما در دسترس نیست. محله یا پاساژ را از نوار بالا انتخاب کنید.</p>}
    </div>
  );
}

export function RecentSessions() {
  const { session, resume } = useBrief();
  const router = useRouter();
  const [recent, setRecent] = useState<Session[]>([]);
  const current = session?.session_id;

  useEffect(() => {
    if (!current) return;
    const ids = recentSessionIds().filter((id) => id !== current);
    Promise.all(ids.map((id) => getSession(id).catch(() => null))).then((all) =>
      setRecent(all.filter((s): s is Session => s !== null && label(s) !== null)),
    );
  }, [current]);

  if (recent.length === 0) return null;
  return (
    <section aria-labelledby="recent" className="flex flex-col gap-2">
      <h2 id="recent" className="text-sm font-semibold">
        جلسه‌های اخیر
      </h2>
      <div className="flex flex-wrap gap-2">
        {recent.map((s) => (
          <Button
            key={s.session_id}
            variant="outline"
            size="sm"
            className="max-w-full truncate"
            onClick={async () => {
              const resumed = await resume(s.session_id);
              if (resumed?.step?.kind === "sellers") router.push(`/products/${resumed.step.product_id}/sellers`);
            }}
          >
            {label(s)}
          </Button>
        ))}
      </div>
    </section>
  );
}
