"use client";

import { useEffect, useState } from "react";

// the latest JSON event of an SSE stream; EventSource reconnects by itself, except after an HTTP error, which
// `onRefused` hears of
export function useEventStream<T>(url: string | null, onRefused?: (refused: true) => void): T | null {
  const [latest, setLatest] = useState<{ url: string; data: T } | null>(null);

  useEffect(() => {
    if (!url) return;
    const source = new EventSource(url);
    source.onmessage = (e) => setLatest({ url, data: JSON.parse(e.data) });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) onRefused?.(true);
    };
    return () => source.close();
  }, [url, onRefused]);

  return latest?.url === url ? latest.data : null;
}
