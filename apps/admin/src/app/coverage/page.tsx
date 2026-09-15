'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@isp/shared';
import { CoverageArea, ZONE_LABELS as STATIC_ZONE_LABELS, STATUS_COLORS, STATUS_LABELS, TECH_LABELS, TECH_COLORS } from './coverage-data';

const CoverageMap = dynamic(() => import('./CoverageMap'), {
  ssr: false,
  loading: () => <div style={{ height: 440, borderRadius: 16, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading map…</div>,
});

const FALLBACK_ZONES = ['LAGOS_MAINLAND', 'LAGOS_ISLAND', 'IKORODU', 'OTHER'];
const STATUSES = ['COVERED', 'IN_PROGRESS', 'PLANNED'];
const TECHS = ['FIBER', 'RADIO'] as const;

interface CoverageZone { id: string; slug: string; label: string }

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 5, fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 };

export default function CoveragePage() {
  const [areas, setAreas] = useState<CoverageArea[]>([]);
  const [zones, setZones] = useState<CoverageZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [techFilter, setTechFilter] = useState<(typeof TECHS)[number]>('FIBER');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState({ name: '', zone: 'IKORODU', lga: '', status: 'COVERED', technology: 'FIBER' as (typeof TECHS)[number], lat: '', lng: '', notes: '' });
  const [showZoneManager, setShowZoneManager] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [zoneSaving, setZoneSaving] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingZoneName, setEditingZoneName] = useState('');
  const [zoneUpdating, setZoneUpdating] = useState(false);

  const ZONE_LABELS: Record<string, string> = (() => {
    const m: Record<string, string> = { ...STATIC_ZONE_LABELS };
    for (const z of zones) m[z.slug] = z.label;
    return m;
  })();
  const ZONES = zones.length
    ? zones.map((z) => z.slug)
    : (areas.length ? Array.from(new Set(areas.map((a) => a.zone))).sort((a, b) => (ZONE_LABELS[a] ?? a).localeCompare(ZONE_LABELS[b] ?? b)) : FALLBACK_ZONES);

  async function load() {
    setLoading(true);
    try {
      setAreas(await api<CoverageArea[]>('/coverage-areas'));
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load coverage areas');
    } finally {
      setLoading(false);
    }
  }

  async function loadZones() {
    try {
      const zs = await api<CoverageZone[]>('/coverage-zones');
      setZones(zs);
      // keep zoneFilter valid
      if (zs.length && zoneFilter !== 'ALL' && !zs.some((z) => z.slug === zoneFilter)) setZoneFilter('ALL');
    } catch {}
  }

  useEffect(() => { void load(); void loadZones(); }, []);

  async function createZone() {
    const name = newZoneName.trim();
    if (!name) { setError('Zone name is required'); return; }
    if (name.length < 2) { setError('Zone name must be at least 2 characters'); return; }
    setZoneSaving(true);
    try {
      await api('/coverage-zones', { method: 'POST', body: JSON.stringify({ name }) });
      setNewZoneName('');
      await loadZones();
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create zone');
    } finally {
      setZoneSaving(false);
    }
  }

  async function deleteZone(id: string, slug: string) {
    if (!confirm(`Delete zone "${slug}"? Areas using it must be moved first.`)) return;
    try {
      await api(`/coverage-zones/${id}`, { method: 'DELETE' });
      await loadZones();
      if (zoneFilter === slug) setZoneFilter('ALL');
      if (form.zone === slug) setForm((f) => ({ ...f, zone: zones[0]?.slug ?? 'IKORODU' }));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete zone');
    }
  }

  function startEditZone(z: CoverageZone) {
    setEditingZoneId(z.id);
    setEditingZoneName(z.label);
  }

  async function saveEditZone() {
    if (!editingZoneId) return;
    const name = editingZoneName.trim();
    if (!name) { setError('Zone name is required'); return; }
    if (name.length < 2) { setError('Zone name must be at least 2 characters'); return; }
    setZoneUpdating(true);
    try {
      await api(`/coverage-zones/${editingZoneId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      setEditingZoneId(null);
      setEditingZoneName('');
      await loadZones();
      await load();
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update zone');
    } finally {
      setZoneUpdating(false);
    }
  }

  const techCounts = useMemo(() => ({
    FIBER: areas.filter((a) => (a.technology ?? 'FIBER') === 'FIBER').length,
    RADIO: areas.filter((a) => (a.technology ?? 'FIBER') === 'RADIO').length,
  }), [areas]);

  const filtered = useMemo(() => areas.filter((a) => {
    if ((a.technology ?? 'FIBER') !== techFilter) return false;
    if (zoneFilter !== 'ALL' && a.zone !== zoneFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || (a.lga ?? '').toLowerCase().includes(q) || (a.notes ?? '').toLowerCase().includes(q);
  }), [areas, zoneFilter, techFilter, search]);

  function openCreate() {
    setEditId(null);
    setForm({ name: '', zone: zoneFilter === 'ALL' ? 'IKORODU' : zoneFilter, lga: '', status: 'COVERED', technology: techFilter, lat: '', lng: '', notes: '' });
    setDrawerOpen(true);
  }

  function openEdit(a: CoverageArea) {
    setEditId(a.id);
    setForm({
      name: a.name,
      zone: a.zone,
      lga: a.lga ?? '',
      status: a.status,
      technology: ((a.technology as (typeof TECHS)[number]) ?? 'FIBER'),
      lat: a.lat != null ? String(a.lat) : '',
      lng: a.lng != null ? String(a.lng) : '',
      notes: a.notes ?? '',
    });
    if (a.lat != null && a.lng != null) setFocus({ lat: a.lat, lng: a.lng });
    setDrawerOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setError('Area name is required'); return; }
    // Client-side lat/lng validation gives immediate, clear feedback before the API's
    // 400 ("lat must not be greater than 90"). Catches swapped fields / out-of-range.
    if (form.lat.trim() !== '') {
      const v = Number(form.lat);
      if (!Number.isFinite(v)) { setError('Latitude must be a number, e.g. 6.58 (Ikorodu) — found "' + form.lat.trim() + '"'); return; }
      if (v < -90 || v > 90) { setError(`Latitude ${v} is out of range — must be -90 to 90. Did you swap lat/lng? Example Lagos: lat 6.58, lng 3.45`); return; }
    }
    if (form.lng.trim() !== '') {
      const v = Number(form.lng);
      if (!Number.isFinite(v)) { setError('Longitude must be a number, e.g. 3.45 (Ikorodu) — found "' + form.lng.trim() + '"'); return; }
      if (v < -180 || v > 180) { setError(`Longitude ${v} is out of range — must be -180 to 180. Example Lagos: lat 6.58, lng 3.45`); return; }
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        zone: form.zone,
        lga: form.lga.trim() || undefined,
        status: form.status,
        technology: form.technology,
        notes: form.notes.trim() || undefined,
      };
      if (form.lat.trim() !== '') body.lat = Number(form.lat);
      if (form.lng.trim() !== '') body.lng = Number(form.lng);
      if (editId) await api(`/coverage-areas/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/coverage-areas', { method: 'POST', body: JSON.stringify(body) });
      setDrawerOpen(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save area');
    } finally {
      setSaving(false);
    }
  }

  async function remove(a: CoverageArea) {
    if (!confirm(`Delete coverage area "${a.name}"?`)) return;
    try {
      await api(`/coverage-areas/${a.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete area');
    }
  }

  return (
    <>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Coverage Map</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {TECH_LABELS[techFilter]} areas you serve — toggle Fiber/Radio above; customers see the same toggle
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add {TECH_LABELS[techFilter]} Area
        </button>
      </div>

      <div className="badge-tabs" style={{ width: 'fit-content', marginBottom: 12 }}>
        {TECHS.map((t) => (
          <button key={t} onClick={() => setTechFilter(t)}
            className={`tab-item${techFilter === t ? ' active' : ''}`}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: TECH_COLORS[t] }} />
            {TECH_LABELS[t]}
            <span style={{ fontSize: '0.7rem', fontWeight: 700, background: techFilter === t ? TECH_COLORS[t] : '#E2E8F0', color: techFilter === t ? '#fff' : '#64748B', padding: '1px 7px', borderRadius: 10 }}>{techCounts[t]}</span>
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 700 }}>×</button>
        </div>
      )}

      <div className="data-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: '1 1 200px', width: 'auto' }}>
            <svg width="16" height="16" fill="none" stroke="var(--text-muted)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search areas…" />
          </div>
          <div className="badge-tabs">
            {['ALL', ...ZONES].map((z) => (
              <button key={z} onClick={() => setZoneFilter(z)}
                className={`tab-item${zoneFilter === z ? ' active' : ''}`}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {z === 'ALL' ? 'All zones' : ZONE_LABELS[z]}
              </button>
            ))}
          </div>
          <button onClick={() => setShowZoneManager(true)} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#334155', whiteSpace: 'nowrap' }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Manage Zones
          </button>
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{filtered.length} {TECH_LABELS[techFilter].toLowerCase()} area{filtered.length === 1 ? '' : 's'}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px' }} className="coverage-split">
          <div style={{ padding: 16, minWidth: 0 }}>
            <CoverageMap
              areas={filtered}
              height={480}
              focus={focus}
              onPick={drawerOpen ? (lat, lng) => setForm((f) => ({ ...f, lat: String(lat), lng: String(lng) })) : undefined}
              picked={drawerOpen && form.lat.trim() !== '' && form.lng.trim() !== '' ? { lat: Number(form.lat), lng: Number(form.lng) } : null}
            />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {STATUSES.map((s) => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s] }} />
                  {STATUS_LABELS[s]}
                </span>
              ))}
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--border-color)', maxHeight: 560, overflowY: 'auto' }}>
            {loading ? (
              <p style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
            ) : filtered.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 40, color: 'var(--text-muted)' }}>
                <svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>No {TECH_LABELS[techFilter].toLowerCase()} areas yet</span>
                <span style={{ fontSize: '0.75rem' }}>Add the first {TECH_LABELS[techFilter].toLowerCase()} area in this view — switch toggle to see {TECH_LABELS[techFilter === 'FIBER' ? 'RADIO' : 'FIBER'].toLowerCase()}.</span>
              </div>
            ) : filtered.map((a) => (
              <div key={a.id}
                onClick={() => a.lat != null && a.lng != null && setFocus({ lat: a.lat, lng: a.lng })}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', cursor: a.lat != null ? 'pointer' : 'default' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[a.status] ?? '#94A3B8', marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>{a.name}<span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: TECH_COLORS[(a.technology ?? 'FIBER')] + '18', color: TECH_COLORS[(a.technology ?? 'FIBER')] }}>{TECH_LABELS[(a.technology ?? 'FIBER')]}</span></div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>
                    {ZONE_LABELS[a.zone] ?? a.zone}{a.lga ? ` · ${a.lga}` : ''}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: STATUS_COLORS[a.status] ?? '#64748B', fontWeight: 700, marginTop: 2 }}>
                    {STATUS_LABELS[a.status] ?? a.status}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button className="btn-sm-outline" style={{ padding: '3px 10px' }} onClick={(e) => { e.stopPropagation(); openEdit(a); }}>Edit</button>
                  <button className="btn-sm-outline" style={{ padding: '3px 10px', color: '#DC2626', borderColor: '#FECACA' }} onClick={(e) => { e.stopPropagation(); void remove(a); }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {drawerOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.42)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setDrawerOpen(false)}>
          <div style={{ background: 'white', width: 440, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-16px 0 40px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding: '20px 22px 14px', borderBottom: '1px solid #F1F5F9', position: 'sticky', top: 0, background: 'linear-gradient(180deg,#fff 85%,#F8FAFC)', zIndex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 13, background: form.technology === 'FIBER' ? '#F1592515' : '#F59E0B1A', color: TECH_COLORS[form.technology], border: `1.5px solid ${TECH_COLORS[form.technology]}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {form.technology === 'FIBER' ? (
                      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M12 2v20M8 6h8M8 12h8M8 18h8" /><circle cx="12" cy="12" r="10" opacity="0.12" /></svg>
                    ) : (
                      <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><circle cx="12" cy="20" r="0.9" fill="currentColor" stroke="none" /></svg>
                    )}
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, letterSpacing: -0.3 }}>{editId ? 'Edit Area' : 'Add Coverage Area'}</h2>
                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '3px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: TECH_COLORS[form.technology], display: 'inline-block' }} />
                      {form.technology === 'FIBER' ? 'FTTH — fiber to the home' : 'Fixed wireless — 5GHz radio'} · pin on map or enter coords
                    </p>
                  </div>
                </div>
                <button onClick={() => setDrawerOpen(false)} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              {/* quick tech switch in header */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {TECHS.map((t) => (
                  <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, technology: t }))}
                    style={{ flex: 1, padding: '7px 10px', borderRadius: 999, border: form.technology === t ? `1.5px solid ${TECH_COLORS[t]}` : '1px solid #E2E8F0', background: form.technology === t ? TECH_COLORS[t] : '#fff', color: form.technology === t ? '#fff' : '#334155', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: form.technology === t ? '#fff' : TECH_COLORS[t] }} />
                    {TECH_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: '18px 22px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Area name */}
              <div>
                <label style={{ ...lbl, display: 'flex', justifyContent: 'space-between' }}><span>Area name <span style={{ color: '#EF4444' }}>*</span></span><span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: form.name ? '#0F172A' : '#94A3B8', fontSize: '0.68rem' }}>{form.name.length}/40</span></label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  </span>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Igbogbo" maxLength={40}
                    style={{ ...inp, paddingLeft: 38, background: form.name ? '#fff' : '#F8FAFC', borderColor: form.name ? '#E2E8F0' : '#E2E8F0', fontWeight: 600 }} />
                </div>
              </div>

              {/* Zone + LGA */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Zone</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {ZONES.map((z) => (
                      <button key={z} type="button" onClick={() => setForm((f) => ({ ...f, zone: z }))}
                        style={{ padding: '8px 8px', borderRadius: 12, border: form.zone === z ? '1.5px solid #0F172A' : '1px solid #E2E8F0', background: form.zone === z ? '#0F172A' : '#fff', color: form.zone === z ? '#fff' : '#475569', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s' }}>
                        {ZONE_LABELS[z].split(' ')[0]}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>{ZONE_LABELS[form.zone]}</div>
                </div>
                <div>
                  <label style={lbl}>LGA / district</label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                    </span>
                    <input value={form.lga} onChange={(e) => setForm((f) => ({ ...f, lga: e.target.value }))} placeholder="Ikorodu N." style={{ ...inp, paddingLeft: 32, background: '#fff' }} />
                  </div>
                </div>
              </div>

              {/* Technology big cards */}
              <div>
                <label style={lbl}>Technology</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {TECHS.map((t) => (
                    <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, technology: t }))}
                      style={{ padding: '12px 12px', borderRadius: 14, border: form.technology === t ? `2px solid ${TECH_COLORS[t]}` : '1.5px solid #E2E8F0', background: form.technology === t ? `${TECH_COLORS[t]}10` : '#fff', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.14s', boxShadow: form.technology === t ? `0 4px 12px ${TECH_COLORS[t]}18` : 'none' }}>
                      <span style={{ width: 34, height: 34, borderRadius: 11, background: form.technology === t ? TECH_COLORS[t] : '#F1F5F9', color: form.technology === t ? '#fff' : '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {t === 'FIBER' ? (
                          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M12 2v20M7 7h10M7 12h10M7 17h10" /></svg>
                        ) : (
                          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /></svg>
                        )}
                      </span>
                      <span style={{ lineHeight: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: '0.82rem', color: form.technology === t ? TECH_COLORS[t] : '#0F172A' }}>{TECH_LABELS[t]}</div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t === 'FIBER' ? 'FTTH' : '5GHz'}</div>
                      </span>
                      {form.technology === t && <span style={{ marginLeft: 'auto', width: 20, height: 20, borderRadius: 999, background: TECH_COLORS[t], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem' }}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status pills */}
              <div>
                <label style={lbl}>Status</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {STATUSES.map((s) => (
                    <button key={s} type="button" onClick={() => setForm((f) => ({ ...f, status: s }))}
                      style={{ padding: '7px 12px', borderRadius: 999, border: form.status === s ? `1.5px solid ${STATUS_COLORS[s]}` : '1px solid #E2E8F0', background: form.status === s ? `${STATUS_COLORS[s]}14` : '#fff', color: form.status === s ? STATUS_COLORS[s] : '#64748B', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'all 0.13s' }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: STATUS_COLORS[s] }} />
                      {STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Location */}
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 16, padding: 14 }}>
                <label style={{ ...lbl, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 8, background: '#0F172A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  </span>
                  Location
                  {form.lat && form.lng && (
                    <span style={{ marginLeft: 'auto', fontSize: '0.64rem', fontWeight: 700, color: '#0EA5E9', background: '#E0F2FE', padding: '2px 8px', borderRadius: 999 }}>pinned ✓</span>
                  )}
                </label>
                <p style={{ fontSize: '0.7rem', color: '#64748B', margin: '0 0 10px', lineHeight: 1.45 }}>
                  Tap the map to drop a pin, or type. Lagos: <b style={{ color: '#0F172A' }}>6.58</b> / <b style={{ color: '#0F172A' }}>3.45</b>
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.62rem', fontWeight: 800, color: '#94A3B8', letterSpacing: 0.5 }}>LAT</span>
                    <input type="number" inputMode="decimal" step="any" min={-90} max={90} value={form.lat} onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))} placeholder="6.58" style={{ ...inp, paddingLeft: 38, background: '#fff', borderColor: form.lat && (Number(form.lat) < -90 || Number(form.lat) > 90) ? '#FCA5A5' : '#E2E8F0' }} />
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: '0.62rem', fontWeight: 800, color: '#94A3B8', letterSpacing: 0.5 }}>LNG</span>
                    <input type="number" inputMode="decimal" step="any" min={-180} max={180} value={form.lng} onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))} placeholder="3.45" style={{ ...inp, paddingLeft: 38, background: '#fff', borderColor: form.lng && (Number(form.lng) < -180 || Number(form.lng) > 180) ? '#FCA5A5' : '#E2E8F0' }} />
                  </div>
                </div>
                {(form.lat.trim() !== '' || form.lng.trim() !== '') && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#334155', background: '#fff', border: '1px solid #E2E8F0', padding: '5px 10px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: '#22C55E' }} />
                      {form.lat || '—'}, {form.lng || '—'}
                    </span>
                    <button type="button" onClick={() => setForm((f) => ({ ...f, lat: '', lng: '' }))} style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label style={{ ...lbl, display: 'flex', justifyContent: 'space-between' }}><span>Notes <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8' }}>(optional)</span></span><span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#94A3B8', fontSize: '0.68rem' }}>{form.notes.length}/120</span></label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} maxLength={120} placeholder="e.g. Covers Igbogbo–Ijede road, fiber POP at ANGLICAN" style={{ ...inp, resize: 'vertical', minHeight: 76, background: '#fff' }} />
              </div>

              {/* Preview */}
              <div style={{ background: '#fff', border: `1.5px solid ${TECH_COLORS[form.technology]}18`, borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 2px 10px rgba(15,23,42,0.04)' }}>
                <span style={{ width: 36, height: 36, borderRadius: 11, background: `${STATUS_COLORS[form.status]}14`, color: STATUS_COLORS[form.status], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.84rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{form.name || 'Area preview'}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{ZONE_LABELS[form.zone]}</span>{form.lga ? <span>· {form.lga}</span> : null}
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: TECH_COLORS[form.technology] }} />
                    <span style={{ fontWeight: 700, color: TECH_COLORS[form.technology] }}>{TECH_LABELS[form.technology]}</span>
                    <span>·</span><span style={{ color: STATUS_COLORS[form.status], fontWeight: 700 }}>{STATUS_LABELS[form.status]}</span>
                  </div>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_COLORS[form.status], flexShrink: 0 }} />
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end', background: '#F8FAFC', position: 'sticky', bottom: 0 }}>
              <button onClick={() => setDrawerOpen(false)} style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer', color: '#334155' }}>Cancel</button>
              <button disabled={saving || !form.name.trim()} onClick={save} style={{ padding: '10px 20px', borderRadius: 999, border: 'none', background: saving || !form.name.trim() ? '#CBD5E1' : '#0F172A', color: '#fff', fontWeight: 800, fontSize: '0.84rem', cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: saving || !form.name.trim() ? 'none' : '0 8px 16px rgba(15,23,42,0.18)', opacity: saving ? 0.8 : 1 }}>
                {saving ? (
                  <>
                    <span style={{ width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: 999, display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                    Saving…
                  </>
                ) : (
                  <>
                    {editId ? 'Save Changes' : 'Add Area'}
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                  </>
                )}
              </button>
            </div>
            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          </div>
        </div>
      )}

      {showZoneManager && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)', zIndex: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowZoneManager(false)}>
          <div style={{ background: '#fff', width: 420, maxWidth: '95vw', borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(15,23,42,0.2)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 11, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
                  </span>
                  <div>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0 }}>Manage Zones</h3>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>{zones.length} zones · used to group coverage areas</p>
                  </div>
                </div>
                <button onClick={() => setShowZoneManager(false)} style={{ width: 30, height: 30, borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </span>
                  <input value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createZone()} placeholder="New zone e.g. Ikorodu West" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 12, border: '1px solid #E2E8F0', fontSize: '0.84rem', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <button disabled={zoneSaving || !newZoneName.trim()} onClick={createZone} style={{ padding: '9px 16px', borderRadius: 12, border: 'none', background: zoneSaving || !newZoneName.trim() ? '#CBD5E1' : '#0F172A', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: zoneSaving || !newZoneName.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>{zoneSaving ? 'Adding…' : 'Add Zone'}</button>
              </div>
              <p style={{ fontSize: '0.66rem', color: '#94A3B8', margin: '8px 0 0' }}>Slug auto-generates as <code>LAGOS_MAINLAND</code> style — you can rename via edit later.</p>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 12px' }}>
              {zones.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No zones yet — add your first.</div>
              ) : zones.map((z) => {
                const count = areas.filter((a) => a.zone === z.slug).length;
                const isEditing = editingZoneId === z.id;
                return (
                  <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, border: '1px solid #F1F5F9', background: '#fff', margin: '6px 0' }}>
                    <span style={{ width: 30, height: 30, borderRadius: 10, background: '#F8FAFC', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, flexShrink: 0 }}>{z.label.slice(0, 2).toUpperCase()}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <input value={editingZoneName} onChange={(e) => setEditingZoneName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveEditZone(); if (e.key === 'Escape') { setEditingZoneId(null); setEditingZoneName(''); } }} autoFocus placeholder="Zone name" style={{ width: '100%', padding: '6px 10px', borderRadius: 10, border: '1px solid #CBD5E1', fontSize: '0.82rem', fontWeight: 700, outline: 'none', boxSizing: 'border-box' }} />
                      ) : (
                        <div style={{ fontWeight: 700, fontSize: '0.84rem' }}>{z.label}</div>
                      )}
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{z.slug} · {count} area{count === 1 ? '' : 's'}</div>
                    </div>
                    <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: count ? '#DCFCE7' : '#F1F5F9', color: count ? '#166534' : '#94A3B8' }}>{count}</span>
                    {isEditing ? (
                      <>
                        <button disabled={zoneUpdating || !editingZoneName.trim()} onClick={saveEditZone} style={{ padding: '6px 10px', borderRadius: 10, border: 'none', background: zoneUpdating || !editingZoneName.trim() ? '#CBD5E1' : '#0F172A', color: '#fff', fontSize: '0.72rem', fontWeight: 700, cursor: zoneUpdating || !editingZoneName.trim() ? 'not-allowed' : 'pointer' }}>{zoneUpdating ? 'Saving…' : 'Save'}</button>
                        <button onClick={() => { setEditingZoneId(null); setEditingZoneName(''); }} style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEditZone(z)} style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#0F172A', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => deleteZone(z.id, z.slug)} title={count ? 'Move/delete areas using this zone first' : 'Delete zone'} style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #FECACA', background: '#fff', color: count ? '#94A3B8' : '#DC2626', fontSize: '0.72rem', fontWeight: 700, cursor: count ? 'not-allowed' : 'pointer', opacity: count ? 0.6 : 1 }}>Delete</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid #F1F5F9', background: '#F8FAFC', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Zones are tenant-scoped. Deleting requires no areas use it.</span>
              <button onClick={() => setShowZoneManager(false)} style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
