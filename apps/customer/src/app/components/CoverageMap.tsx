'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CoverageArea, STATUS_COLORS, STATUS_LABELS, ZONE_LABELS } from './coverage-data';

function pinIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.45)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export default function CoverageMap({ areas, height = 320, focus = null }: { areas: CoverageArea[]; height?: number | string; focus?: { lat: number; lng: number } | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { center: [6.58, 3.45], zoom: 11, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    areas.filter((a) => a.lat != null && a.lng != null).forEach((a) => {
      const color = STATUS_COLORS[a.status] ?? '#94A3B8';
      L.marker([a.lat as number, a.lng as number], { icon: pinIcon(color) })
        .bindPopup(
          `<strong>${esc(a.name)}</strong><br/>${esc(ZONE_LABELS[a.zone] ?? a.zone)}${a.lga ? ` · ${esc(a.lga)}` : ''}<br/>` +
          `<span style="color:${color};font-weight:600">${esc(STATUS_LABELS[a.status] ?? a.status)}</span>`,
        )
        .addTo(layer);
    });
    return () => { layer.remove(); };
  }, [areas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 13));
  }, [focus]);

  return <div ref={containerRef} style={{ height, width: '100%', borderRadius: 16, zIndex: 0 }} />;
}
