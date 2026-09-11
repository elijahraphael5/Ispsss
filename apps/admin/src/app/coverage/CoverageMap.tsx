'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CoverageArea, STATUS_COLORS, STATUS_LABELS, ZONE_LABELS } from './coverage-data';

function pinIcon(color: string, active = false) {
  return L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.45)${active ? `;outline:3px solid ${color}55` : ''}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export default function CoverageMap({
  areas,
  height = 440,
  focus,
  onPick,
  picked,
}: {
  areas: CoverageArea[];
  height?: number | string;
  focus?: { lat: number; lng: number } | null;
  onPick?: (lat: number, lng: number) => void;
  picked?: { lat: number; lng: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, { center: [6.58, 3.45], zoom: 11, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => {
      onPickRef.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });
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

  const focusLat = focus?.lat;
  const focusLng = focus?.lng;
  useEffect(() => {
    if (focusLat == null || focusLng == null || !mapRef.current) return;
    mapRef.current.setView([focusLat, focusLng], Math.max(mapRef.current.getZoom(), 14), { animate: true });
  }, [focusLat, focusLng]);

  const pickedLat = picked?.lat;
  const pickedLng = picked?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pickedLat == null || pickedLng == null) return;
    const marker = L.marker([pickedLat, pickedLng], { icon: pinIcon('#F15925', true) }).addTo(map);
    return () => { marker.remove(); };
  }, [pickedLat, pickedLng]);

  return <div ref={containerRef} style={{ height, width: '100%', borderRadius: 16, zIndex: 0 }} />;
}
