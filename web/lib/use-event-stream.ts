"use client";

import { useEffect, useState } from "react";

// the latest JSON event of an SSE stream; EventSource reconnects by itself
export function useEventStream<T>(url: string | null): T | null {
  const [latest, setLatest] = useState<{ url: string; data: T } | null>(null);

  useEffect(() => {
    if (!url) return;
    const source = new EventSource(url);
    source.onmessage = (e) => setLatest({ url, data: JSON.parse(e.data) });
    return () => source.close();
  }, [url]);

  return latest?.url === url ? latest.data : null;
}
