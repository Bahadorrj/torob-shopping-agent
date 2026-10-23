"use client";

import { useCallback, useEffect } from "react";

// An overlay (drawer, sheet) that browser back closes: opening pushes a same-URL history entry marked with `key`,
// back pops it, and closing from the UI steps back over it so no dead entry is left.
export function useBackCloses(key: string, setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onPop = () => {
      if (!history.state?.[key]) setOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [key, setOpen]);

  return useCallback(
    (open: boolean, details?: { reason?: string }) => {
      // the spread keeps the router's own state on the entry
      if (open && !history.state?.[key]) history.pushState({ ...history.state, [key]: true }, "");
      if (!open && history.state?.[key]) {
        // a tap outside may be a link or back tap whose navigation a history step would undo; unmark the entry instead
        if (details?.reason === "outside-press") history.replaceState({ ...history.state, [key]: undefined }, "");
        else history.back();
      }
      setOpen(open);
    },
    [key, setOpen],
  );
}
