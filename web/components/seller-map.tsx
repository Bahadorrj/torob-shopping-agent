"use client";

import "leaflet/dist/leaflet.css";

import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

import type { SellerRow } from "@/lib/api";
import { faDigits, faText } from "@/lib/format";

const TILES = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export type Pin = { key: string; label: string; lat: number; lon: number; rows: SellerRow[] };

// shops in one pasaj share one pin; a shop outside a pasaj gets its own
export const pinKey = (s: SellerRow) => (s.pasaj ? `pasaj:${s.pasaj}` : `shop:${s.shop_id}`);

export function pins(rows: SellerRow[]): Pin[] {
  const out = new Map<string, Pin>();
  for (const s of rows) {
    if (s.lat === null || s.lon === null) continue;
    const key = pinKey(s);
    const p = out.get(key) ?? { key, label: s.pasaj ? faText(`پاساژ ${s.pasaj}`) : s.shop_name, lat: 0, lon: 0, rows: [] };
    p.rows.push(s);
    out.set(key, p);
  }
  for (const p of out.values()) {
    p.lat = p.rows.reduce((t, s) => t + s.lat!, 0) / p.rows.length;
    p.lon = p.rows.reduce((t, s) => t + s.lon!, 0) / p.rows.length;
  }
  return [...out.values()];
}

type Leaflet = { L: typeof import("leaflet"); map: LeafletMap; layer: LayerGroup };

export function SellerMap({ pins, selected, onSelect }: { pins: Pin[]; selected: string | null; onSelect: (key: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [leaflet, setLeaflet] = useState<Leaflet | null>(null);

  // leaflet reads `window` on import, so it loads in the browser only
  useEffect(() => {
    let map: LeafletMap | undefined;
    let gone = false;
    import("leaflet").then((L) => {
      if (gone || !el.current) return;
      map = L.map(el.current);
      L.tileLayer(TILES, { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      setLeaflet({ L, map, layer: L.layerGroup().addTo(map) });
    });
    return () => {
      gone = true;
      map?.remove();
    };
  }, []);

  useEffect(() => {
    if (!leaflet || pins.length === 0) return;
    leaflet.map.fitBounds(
      pins.map((p) => [p.lat, p.lon]),
      { padding: [32, 32], maxZoom: 17 },
    );
  }, [leaflet, pins]);

  useEffect(() => {
    if (!leaflet) return;
    const { L, layer } = leaflet;
    layer.clearLayers();
    for (const p of pins) {
      const on = p.key === selected;
      const icon = L.divIcon({
        className: "",
        iconSize: [32, 32],
        html: `<span class="flex size-8 items-center justify-center rounded-full border-2 border-white text-sm font-bold shadow ${on ? "bg-amber-500 text-black" : "bg-primary text-primary-foreground"}">${faDigits(p.rows.length)}</span>`,
      });
      const marker = L.marker([p.lat, p.lon], { icon, zIndexOffset: on ? 1000 : 0 }).on("click", () => onSelect(p.key)).addTo(layer);
      const pin = marker.getElement()!;
      pin.setAttribute("aria-label", `${p.label}: ${faDigits(p.rows.length)} فروشنده روی نقشه`);
      pin.setAttribute("aria-pressed", String(on));
    }
  }, [leaflet, pins, selected, onSelect]);

  // isolate keeps leaflet's z-indexed panes under the brief bar; ltr because leaflet controls assume it
  return <div ref={el} dir="ltr" className="isolate h-80 w-full rounded-lg border" />;
}
