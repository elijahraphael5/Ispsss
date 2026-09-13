'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuthStore, api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';
import { CoverageArea, ZONE_LABELS, STATUS_COLORS, STATUS_LABELS } from '../components/coverage-data';

const CoverageMap = dynamic(() => import('../components/CoverageMap'), {
  ssr: false,
  loading: () => <div style={{ height: 460, borderRadius: 16, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading map…</div>,
});

const ZONES = ['LAGOS_MAINLAND', 'LAGOS_ISLAND', 'IKORODU', 'OTHER'];
const STATUSES = ['COVERED', 'IN_PROGRESS', 'PLANNED'];

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', background: '#fff' };

export default function CoveragePage() {
  const { accessToken } = useAuthStore();
  const router = useRouter();
  const [areas, setAreas] = useState<CoverageArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    api<CoverageArea[]>('/coverage-areas')
      .then(setAreas)
      .catch((e: any) => setError(e?.message ?? 'Failed to load coverage areas'))
      .finally(() => setLoading(false));
  }, [accessToken, router]);

  const filtered = useMemo(() => areas.filter((a) => {
    if (zoneFilter !== 'ALL' && a.zone !== zoneFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || (a.lga ?? '').toLowerCase().includes(q) || (a.notes ?? '').toLowerCase().includes(q);
  }), [areas, zoneFilter, search]);

  const counts = useMemo(() => ({
    COVERED: areas.filter((a) => a.status === 'COVERED').length,
    IN_PROGRESS: areas.filter((a) => a.status === 'IN_PROGRESS').length,
    PLANNED: areas.filter((a) => a.status === 'PLANNED').length,
  }), [areas]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={240} height={28} />
        <div className="grid-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} height={92} />)}
        </div>
        <SkeletonCard height={420} />
      </div>
    );
  }

  return (
    <>
      <div>
        <h1 className="page-title">Coverage Map</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>
          Areas where Hikonnect fiber is available, in progress, or planned.
        </p>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      <div className="grid-3">
        {STATUSES.map((s) => (
          <div key={s} className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${STATUS_COLORS[s]}14`, color: STATUS_COLORS[s], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{STATUS_LABELS[s]}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: STATUS_COLORS[s] }}>{counts[s as keyof typeof counts]}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="data-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search areas…"
            style={{ ...inp, flex: '1 1 200px', width: 'auto' }}
          />
          <div className="badge-tabs">
            {['ALL', ...ZONES].map((z) => (
              <button key={z} onClick={() => setZoneFilter(z)}
                className={`tab-item${zoneFilter === z ? ' active' : ''}`}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}>
                {z === 'ALL' ? 'All zones' : ZONE_LABELS[z]}
              </button>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {filtered.length} area{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="coverage-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
          <div style={{ padding: 16, minWidth: 0 }}>
            <CoverageMap areas={filtered} height={460} focus={focus} />
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {STATUSES.map((s) => (
                <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s] }} />
                  {STATUS_LABELS[s]}
                </span>
              ))}
            </div>
          </div>

          <div style={{ borderLeft: '1px solid var(--border-color)', maxHeight: 540, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 40, color: 'var(--text-muted)' }}>
                <svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{areas.length === 0 ? 'Coverage map coming soon' : 'No areas match your filters'}</span>
                <span style={{ fontSize: '0.75rem', textAlign: 'center' }}>
                  {areas.length === 0 ? 'Our coverage map is being updated — check back shortly.' : 'Try a different zone or search term.'}
                </span>
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
                  {a.notes && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>{a.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
