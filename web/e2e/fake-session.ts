import type { Page } from "@playwright/test";

type Brief = Record<string, unknown>;
type Step = { kind: "search" } | { kind: "sellers"; product_id: string; title?: string | null };

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
};

export const centers = [
  { kind: "area", name: "فردوسی", lat: 35.6905, lon: 51.4172 },
  { kind: "pasaj", name: "علاالدین", lat: 35.6949, lon: 51.4113 },
];

// In-page stand-in for the /sessions API: keeps briefs, merges patches and re-runs the step through `results`.
export async function fakeSessions(page: Page, results: Results, seed: Record<string, { brief?: Brief; step?: Step }> = {}) {
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
