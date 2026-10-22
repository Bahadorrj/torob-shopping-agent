"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createSession, getSession, patchSession, type Session, type SessionPatch } from "@/lib/api";

const CURRENT = "pasazhgard.session";
const RECENT = "pasazhgard.sessions";
const RECENT_MAX = 6;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function recentSessionIds(): string[] {
  try {
    return JSON.parse(read(RECENT) ?? "[]");
  } catch {
    return [];
  }
}

function remember(id: string) {
  write(CURRENT, id);
  write(RECENT, JSON.stringify([id, ...recentSessionIds().filter((x) => x !== id)].slice(0, RECENT_MAX)));
}

async function load(id: string | null): Promise<Session> {
  const session = (id && (await getSession(id))) || (await createSession());
  remember(session.session_id);
  return session;
}

type Brief = {
  session: Session | null;
  pending: boolean;
  error: boolean;
  // patches the brief and/or step; the response carries the re-run results of the current step
  patch: (change: SessionPatch) => Promise<Session | null>;
  resume: (id: string) => Promise<Session | null>;
};

const BriefContext = createContext<Brief | null>(null);

export function useBrief() {
  const ctx = useContext(BriefContext);
  if (!ctx) throw new Error("useBrief outside BriefProvider");
  return ctx;
}

export function BriefProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState(false);
  const current = useRef<Promise<Session> | null>(null);
  // only the latest request may set the state, so a slow older response cannot overwrite a newer one
  const seq = useRef(0);

  const run = useCallback(async (request: () => Promise<Session>) => {
    const mine = ++seq.current;
    setPending((n) => n + 1);
    try {
      const s = await request();
      if (mine === seq.current) {
        setSession(s);
        setError(false);
      }
      return s;
    } catch {
      if (mine === seq.current) setError(true);
      return null;
    } finally {
      setPending((n) => n - 1);
    }
  }, []);

  const ready = useCallback(
    () =>
      (current.current ??= load(read(CURRENT)).catch((e) => {
        // try again on the next request
        current.current = null;
        throw e;
      })),
    [],
  );

  useEffect(() => {
    ready().then(setSession, () => setError(true));
  }, [ready]);

  const patch = useCallback(
    (change: SessionPatch) =>
      run(async () => {
        const s = await ready();
        return patchSession(s.session_id, change);
      }),
    [run, ready],
  );

  const resume = useCallback(
    (id: string) => {
      current.current = load(id);
      return run(() => current.current!);
    },
    [run],
  );

  const value = useMemo(() => ({ session, pending: pending > 0, error, patch, resume }), [session, pending, error, patch, resume]);
  return <BriefContext.Provider value={value}>{children}</BriefContext.Provider>;
}
