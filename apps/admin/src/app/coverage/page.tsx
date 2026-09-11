'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@isp/shared';
import { CoverageArea, ZONE_LABELS, STATUS_COLORS, STATUS_LABELS } from './coverage-data';

const CoverageMap = dynamic(() => import('./CoverageMap'), {
  ssr: false,
  loading: () => <div style={{ height: 440, borderRadius: 16, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading map…</div>,
});

const ZONES = ['LAGOS_MAINLAND', 'LAGOS_ISLAND', 'IKORODU', 'OTHER'];
const STATUSES = ['COVERED', 'IN_PROGRESS', 'PLANNED'];

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 5, fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 };

export default function CoveragePage() {
  const [areas, setAreas] = useState<CoverageArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState({ name: '', zone: 'IKORODU', lga: '', status: 'COVERED', lat: '', lng: '', notes: '' });

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

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => areas.filter((a) => {
    if (zoneFilter !== 'ALL' && a.zone !== zoneFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || (a.lga ?? '').toLowerCase().includes(q) || (a.notes ?? '').toLowerCase().includes(q);
  }), [areas, zoneFilter, search]);

  function openCreate() {
    setEditId(null);
    setForm({ name: '', zone: zoneFilter === 'ALL' ? 'IKORODU' : zoneFilter, lga: '', status: 'COVERED', lat: '', lng: '', notes: '' });
    setDrawerOpen(true);
  }

  function openEdit(a: CoverageArea) {
    setEditId(a.id);
    setForm({
      name: a.name,
      zone: a.zone,
      lga: a.lga ?? '',
      status: a.status,
      lat: a.lat != null ? String(a.lat) : '',
      lng: a.lng != null ? String(a.lng) : '',
      notes: a.notes ?? '',
    });
    if (a.lat != null && a.lng != null) setFocus({ lat: a.lat, lng: a.lng });
    setDrawerOpen(true);
  }

  async function save() {
    if (!form.name.trim()) { setError('Area name is required'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        zone: form.zone,
        lga: form.lga.trim() || undefined,
        status: form.status,
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
            Fiber areas you serve — customers see this map on their dashboard
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Area
        </button>
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
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{filtered.length} area{filtered.length === 1 ? '' : 's'}</span>
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
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>No areas yet</span>
                <span style={{ fontSize: '0.75rem' }}>Add the first area you have passed fiber to.</span>
              </div>
            ) : filtered.map((a) => (
              <div key={a.id}
                onClick={() => a.lat != null && a.lng != null && setFocus({ lat: a.lat, lng: a.lng })}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid var(--border-color)', cursor: a.lat != null ? 'pointer' : 'default' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[a.status] ?? '#94A3B8', marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{a.name}</div>
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
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setDrawerOpen(false)}>
          <div style={{ background: 'white', padding: 28, width: 440, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{editId ? 'Edit Area' : 'Add Area'}</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setDrawerOpen(false)}>✕</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Area name</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Igbogbo" style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Zone</label>
                  <select value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} style={{ ...inp, background: '#fff' }}>
                    {ZONES.map((z) => <option key={z} value={z}>{ZONE_LABELS[z]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>LGA / district</label>
                  <input value={form.lga} onChange={(e) => setForm((f) => ({ ...f, lga: e.target.value }))} placeholder="e.g. Ikorodu North" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={{ ...inp, background: '#fff' }}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Location</label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                  Click anywhere on the map to drop the pin, or type coordinates.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <input value={form.lat} onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))} placeholder="Latitude" style={inp} />
                  <input value={form.lng} onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))} placeholder="Longitude" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Notes (optional)</label>
                <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} placeholder="e.g. Covers Igbogbo–Ijede road" style={{ ...inp, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn-outline" onClick={() => setDrawerOpen(false)}>Cancel</button>
                <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Area'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
