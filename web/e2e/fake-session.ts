import type { Page } from "@playwright/test";

import { runEvents } from "./agent-events.mjs";

type Brief = Record<string, unknown>;
type Step =
  | { kind: "search" }
  | { kind: "sellers"; product_id: string; title?: string | null }
  | { kind: "compare"; product_ids: string[] };

export const emptyBrief = (): Brief => ({
  need: null,
  items: [],
  budget: { max_total_toman: null, max_per_item_toman: null },
  origin: null,
  area: null,
  visit_window: { date: null, earliest_arrival: null, latest_departure: null },
  travel_mode: null,
  payment: { kind: "any", provider: null },
  must_have: { warranty: false, test_in_presence: false, fast_delivery: false },
  priority: "cheapest",
  plan: [],
  inquiries: [],
});

type Results = {
  search?: (brief: Brief) => object;
  sellers?: (brief: Brief, productId: string) => object;
  compare?: (brief: Brief, productIds: string[]) => object;
};

export const centers = [
  { kind: "area", name: "فردوسی", lat: 35.6905, lon: 51.4172 },
  { kind: "pasaj", name: "علاالدین", lat: 35.6949, lon: 51.4113 },
];

// In-page stand-in for the /sessions API: keeps briefs, merges patches and re-runs the step through `results`.
// `messages`: the session's checkpointed agent thread, as GET /sessions/{id}/messages returns it
export async function fakeSessions(page: Page, results: Results, seed: Record<string, { brief?: Brief; step?: Step; messages?: object[] }> = {}) {
  const sessions = new Map(Object.entries(seed).map(([id, s]) => [id, { brief: { ...emptyBrief(), ...s.brief }, step: s.step ?? null }]));
  const patches: { brief?: Brief; step?: Step }[] = [];
  let next = 1;
  const body = (id: string, withResults: boolean) => {
    const s = sessions.get(id)!;
    let out: object | null = null;
    if (withResults && s.step?.kind === "search" && s.brief.need) out = results.search?.(s.brief) ?? null;
    if (withResults && s.step?.kind === "sellers") {
      out = results.sellers?.(s.brief, s.step.product_id) ?? null;
      s.step.title = (out as { title?: string } | null)?.title ?? null;
    }
    if (withResults && s.step?.kind === "compare") out = results.compare?.(s.brief, s.step.product_ids) ?? null;
    return { session_id: id, brief: s.brief, step: s.step, areas: ["بهارستان", "شیخ هادی", "فردوسی"], pasajs: ["علاالدین"], centers, results: out };
  };
  await page.route("**/api/sessions**", async (route) => {
    const req = route.request();
    const id = new URL(req.url()).pathname.split("/")[3];
    if (req.method() === "POST") {
      const sid = `s${next++}`;
      sessions.set(sid, { brief: emptyBrief(), step: null });
      return route.fulfill({ status: 201, json: body(sid, false) });
    }
    if (!sessions.has(id)) return route.fulfill({ status: 404, json: { detail: "session not found" } });
    if (new URL(req.url()).pathname.endsWith("/messages")) return route.fulfill({ json: seed[id]?.messages ?? [] });
    if (req.method() === "PATCH") {
      const change = req.postDataJSON();
      patches.push(change);
      const s = sessions.get(id)!;
      s.brief = { ...s.brief, ...change.brief };
      // the API fills unset area fields with null
      if (s.brief.area) s.brief.area = { radius_m: null, name: null, pasaj: null, ...(s.brief.area as object) };
      if ("step" in change) s.step = change.step && { ...change.step };
      return route.fulfill({ json: body(id, true) });
    }
    return route.fulfill({ json: body(id, false) });
  });
  return { patches, sessions };
}

// Answers this page's agent runs with `blocks` and `text` in place of the fake agent server; `onRun` sees each run's input.
export async function fakeAgent(page: Page, blocks: object[], text = "", onRun?: (input: { messages: { role: string; content?: string }[] }) => void) {
  await page.route("**/api/copilotkit", async (route) => {
    const call = route.request().postDataJSON();
    if (call?.method !== "agent/run") return route.fallback();
    onRun?.(call.body);
    return route.fulfill({ contentType: "text/event-stream", body: runEvents(call.body, blocks, text) });
  });
}

// sends `text` from the assistant's input, inline on the home screen
export async function askHome(page: Page, text: string) {
  await page.getByLabel("پیام به دستیار").fill(text);
  await page.getByRole("button", { name: "بفرست" }).click();
}
