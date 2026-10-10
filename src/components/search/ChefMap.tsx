"use client";
// The Leaflet map for search results (T-040). Loaded in the browser only (see ResultsMap).
// Tiles and data: (c) OpenStreetMap contributors. Pins sit at postal-area centres only (the
// average of a city's areas), never at an address, and a pin is a button: Tab to it, Enter or
// Space selects it. The result list is the accessible equivalent of this map.
import "leaflet/dist/leaflet.css";
import "./map.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { MapPin } from "@/lib/search/search";

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
const GTA_CENTRE: L.LatLngTuple = [43.7, -79.5];

export interface ChefMapProps {
  pins: MapPin[];
  origin: { label: string; point: { lat: number; lng: number } } | null;
  activeCity: string | null;
  onSelect: (city: string) => void;
}

export default function ChefMap({
  pins,
  origin,
  activeCity,
  onSelect,
}: ChefMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, {
      center: GTA_CENTRE,
      zoom: 9,
      // The page scrolls; the wheel must not be taken over by the map.
      scrollWheelZoom: false,
      // No animations: kinder to people who prefer less motion, and nothing is left running when
      // the map is removed.
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const found = markers.current;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
      found.clear();
    };
  }, []);

  // Redraw the pins when the results change.
  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    markers.current.clear();
    const points: L.LatLngTuple[] = [];

    if (origin) {
      const p: L.LatLngTuple = [origin.point.lat, origin.point.lng];
      points.push(p);
      L.marker(p, {
        icon: L.divIcon({
          className: "cn-origin",
          html: "<span></span>",
          iconSize: [18, 18],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(group);
    }
    for (const pin of pins) {
      const p: L.LatLngTuple = [pin.point.lat, pin.point.lng];
      points.push(p);
      const n = pin.items.length;
      const label = `${pin.city}: ${n} ${n === 1 ? "chef" : "chefs"}. Press Enter to select.`;
      const marker = L.marker(p, {
        icon: L.divIcon({
          className: "cn-pin",
          html: `<span aria-hidden="true">${n}</span>`,
          iconSize: [36, 36],
        }),
        keyboard: true,
        title: label,
      });
      marker.on("click", () => select.current(pin.city));
      marker.addTo(group);
      const el = marker.getElement();
      if (el) {
        el.setAttribute("aria-label", label);
        el.setAttribute("aria-pressed", "false");
        // Leaflet only turns Enter into a click for popups, so a button's two keys are handled here.
        el.addEventListener("keydown", (e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            select.current(pin.city);
          }
        });
      }
      markers.current.set(pin.city, marker);
    }
    if (points.length === 1) m.setView(points[0], 11, { animate: false });
    else if (points.length > 1)
      m.fitBounds(L.latLngBounds(points), {
        padding: [40, 40],
        maxZoom: 12,
        animate: false,
      });
    else m.setView(GTA_CENTRE, 9, { animate: false });
  }, [pins, origin]);

  // Show which pin is selected.
  useEffect(() => {
    for (const [city, marker] of markers.current) {
      const el = marker.getElement();
      const on = city === activeCity;
      el?.classList.toggle("cn-pin-active", on);
      el?.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }, [activeCity, pins]);

  return (
    <div
      ref={box}
      role="region"
      aria-label="Map of the cities where these chefs work. The list of results has the same information."
      data-testid="chef-map"
      className="h-80 w-full rounded-lg border border-zinc-400 lg:h-[28rem]"
    />
  );
}
