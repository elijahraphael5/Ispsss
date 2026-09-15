'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useAuthStore, api, formatNaira } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from './components/Skeleton';
import InternetView from './components/InternetView';
import AnalyticsView from './components/AnalyticsView';
import { CoverageArea, STATUS_COLORS, STATUS_LABELS, TECH_LABELS, TECH_COLORS } from './components/coverage-data';

function formatZoneLabel(slug: string): string {
  return slug.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
interface CoverageZone { id: string; slug: string; label: string }

const CoverageMap = dynamic(() => import('./components/CoverageMap'), {
  ssr: false,
  loading: () => <div style={{ height: 320, borderRadius: 16, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading map…</div>,
});

const statusColors: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: '#e6f9ed', fg: '#1db954' },
  SUSPENDED: { bg: '#fde8e8', fg: '#e53e3e' },
  EXPIRED: { bg: '#fef9c3', fg: '#854d0e' },
  PENDING: { bg: '#dbeafe', fg: '#1e40af' },
};

function fmtK(k: number) { return formatNaira(k); }
function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface DashboardData {
  plan?: { name: string; speedMbps: number; priceKobo: number; technology?: string };
  status: string;
  subscription?: { id: string; status: string; type: string; address?: string; startedAt?: string; expiresAt?: string };
  subscriber?: { id: string; legacyId: string | null; hikonnectId: string | null; id2: string | null; firstName: string | null; lastName: string | null; companyName: string | null; stationLabel: string | null; staticIpAddress: string | null; address: string | null; networkType: string | null; pppoeUsername: string | null; createdAt: string; startedAt: string | null; expiresAt: string | null };
  importFields?: {
    id: string | null; id2: string | null; hikonnectId: string | null; pppoeUsername: string | null;
    firstName: string | null; lastName: string | null; companyName: string | null;
    contactNumber: string | null; secondaryContact: string | null; email: string | null; rawEmail: string | null;
    station: string | null; address: string | null; plan: string | null; planTechnology: string | null; planPriceKobo: number | null;
    startDate: string | null; expiryDate: string | null; ipAddress: string | null; ipConflict: boolean; needsMacAddress: boolean;
    userType: string | null; connectionType: string | null;
  };
  cpe?: { id: string; model: string; macAddress: string; ipAddress: string | null; status: string; connectionType?: string; needsMacAddress?: boolean; ipConflict?: boolean };
  user?: { email: string; phone: string | null; secondaryPhone: string | null; name: string | null };
  session?: { username: string; isActive: boolean; framedIpAddress?: string; acctSessionTime?: number; acctStartTime?: string };
  outstandingKobo: number;
  lastPayment?: { amountKobo: number; createdAt: string };
  downloadToday: number;
  uploadToday: number;
  monthlyUsage: number;
}

export default function CustomerDashboard() {
  const { user, accessToken } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'overview' | 'internet' | 'analytics'>('overview');
  const [coverage, setCoverage] = useState<CoverageArea[]>([]);
  const [coverageTech, setCoverageTech] = useState<'FIBER' | 'RADIO'>('FIBER');
  const [coverageZones, setCoverageZones] = useState<CoverageZone[]>([]);

  useEffect(() => {
    if (!accessToken && typeof window !== 'undefined' && !localStorage.getItem('accessToken')) {
      router.push('/login');
    }
  }, [accessToken, router]);

  useEffect(() => {
    if (!accessToken) return;
    api<DashboardData>('/customer/dashboard').then(setData).catch(() => {}).finally(() => setLoading(false));
    api<CoverageArea[]>('/coverage-areas').then(setCoverage).catch(() => {});
    api<CoverageZone[]>('/coverage-zones').then(setCoverageZones).catch(() => {});
  }, [accessToken]);

  if (!user) return null;

  if (loading && view === 'overview') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={260} height={28} />
        <div className="grid-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={100} />)}
        </div>
        <div className="grid-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height={80} />)}
        </div>
        <div className="data-card" style={{ padding: 24, height: 180 }} />
      </div>
    );
  }

  const d = data;
  const sc = statusColors[d?.status ?? 'PENDING'] ?? statusColors.PENDING;
  const firstName = user.name?.trim().split(/\s+/)[0] || user.email?.split('@')[0] || 'Customer';

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            Welcome, {firstName}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {view === 'internet' ? 'Connection status, live session, and usage' : view === 'analytics' ? 'Usage, billing, and account insights' : "Here's an overview of your account"}
          </p>
        </div>
      </div>

      <div className="badge-tabs" style={{ width: 'fit-content' }}>
        {([['overview', 'Overview'], ['internet', 'Internet'], ['analytics', 'Analytics']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`tab-item${view === key ? ' active' : ''}`}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}>
            {label}
          </button>
        ))}
      </div>

      {view === 'overview' && (
        <>
      <div className="grid-4">
        {[
          {
            label: 'Connection Status', value: d?.status ?? '—',
            sub: d?.session?.isActive ? 'Session online' : 'PPPoE session', color: sc.fg,
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
          },
          {
            label: 'Current Plan', value: d?.plan?.name ?? '—',
            sub: d?.plan?.speedMbps ? `${d.plan.speedMbps} Mbps` : null, color: '#2563EB',
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
          },
          {
            label: 'Outstanding Balance', value: d ? fmtK(d.outstandingKobo) : '—',
            sub: (d?.outstandingKobo ?? 0) > 0 ? 'Payment due' : 'All settled',
            color: (d?.outstandingKobo ?? 0) > 0 ? '#DC2626' : '#16A34A',
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
          },
          {
            label: 'Monthly Usage', value: d ? `${(d.monthlyUsage / 1024 / 1024 / 1024).toFixed(2)} GB` : '—',
            sub: d ? `Download today: ${(d.downloadToday / 1024 / 1024).toFixed(1)} MB` : null, color: '#8B5CF6',
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
          },
        ].map(k => (
          <div key={k.label} className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${k.color}14`, color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {k.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{k.label}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: k.color, whiteSpace: 'nowrap' }}>{k.value}</div>
              {k.sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{k.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#0EA5E914', color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Current IP</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'monospace' }}>{(d as any)?.importFields?.ipAddress ?? d?.cpe?.ipAddress ?? d?.session?.framedIpAddress ?? '—'}</div>
            {(d as any)?.importFields?.ipConflict && <div style={{ fontSize: '0.68rem', color: '#DC2626', fontWeight: 700 }}>⚠ IP conflict flagged — contact support</div>}
          </div>
        </div>
        <div className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#16A34A14', color: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Last Payment</div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>{d?.lastPayment ? fmtK(d.lastPayment.amountKobo) : '—'}</div>
            {d?.lastPayment && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(d.lastPayment.createdAt).toLocaleDateString()}</div>}
          </div>
        </div>
      </div>

      {/* 16-column import snapshot — exactly as from sheet */}
      {(d as any)?.importFields && (
        <div className="data-card" style={{ padding: 20, borderLeft: '4px solid #F15925' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: '#F1592514', color: '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </div>
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800 }}>My Customer Record <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: '0.78rem' }}>(16 fields from import)</span></div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  ID, ID2, station, plan, dates & IP — exactly as imported from <code>PHP Radius</code> sheet
                </div>
              </div>
            </div>
            <Link href="/account" style={{ padding: '7px 14px', borderRadius: 20, background: '#F1F5F9', color: 'var(--text-dark)', fontWeight: 700, fontSize: '0.75rem', textDecoration: 'none', border: '1px solid var(--border-color)' }}>
              View full profile →
            </Link>
          </div>

          {(() => {
            const imp: any = (d as any).importFields;
            const sub: any = (d as any).subscriber;
            const expiryTs = imp.expiryDate ? new Date(imp.expiryDate).getTime() : 0;
            const daysLeft = expiryTs ? Math.ceil((expiryTs - Date.now()) / 86400000) : null;
            const pill = (label: string, col: string) => <span style={{ fontSize: '0.62rem', padding: '3px 8px', borderRadius: 20, background: col, color: '#fff', fontWeight: 700 }}>{label}</span>;
            const FieldMini = ({ label, value, mono }: { label: string; value: any; mono?: boolean }) => (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: '0.84rem', fontWeight: 600, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined, color: value && String(value).trim() ? 'var(--text-dark)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value && String(value).trim() ? String(value).trim() : '—'}</div>
              </div>
            );
            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, padding: '14px 16px', borderRadius: 14, background: '#F8FAFC', border: '1px solid var(--border-color)' }}>
                  <FieldMini label="ID" value={imp.id} mono />
                  <FieldMini label="ID2" value={imp.id2} mono />
                  <FieldMini label="Hikonnect ID" value={imp.hikonnectId} mono />
                  <FieldMini label="USER TYPE" value={imp.userType} />
                  <FieldMini label="STATION" value={imp.station} />
                  <FieldMini label="IP ADDRESS" value={imp.ipAddress} mono />
                  <FieldMini label="FIRST NAME" value={imp.firstName} />
                  <FieldMini label="LAST NAME" value={imp.lastName} />
                  <FieldMini label="COMPANY" value={imp.companyName} />
                  <FieldMini label="CONTACT NUMBER" value={[imp.contactNumber, imp.secondaryContact].filter(Boolean).join(' / ') || null} mono />
                  <FieldMini label="EMAIL" value={imp.email} />
                  <FieldMini label="ADDRESS" value={imp.address} />
                  <FieldMini label="PLAN" value={imp.plan} />
                  <FieldMini label="START DATE" value={fmtDate(imp.startDate)} />
                  <FieldMini label="EXPIRY DATE" value={fmtDate(imp.expiryDate)} />
                  <FieldMini label="PASSWORD" value="••••••••" mono />
                  <FieldMini label="PORTAL PASSWORD" value="••••••••" mono />
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, fontSize: '0.75rem', color: 'var(--text-muted)', alignItems: 'center' }}>
                  <span>PPPoE: <strong style={{ fontFamily: 'monospace', color: 'var(--text-dark)' }}>{sub?.pppoeUsername ?? '—'}</strong></span>
                  <span>·</span>
                  <span>Status: <strong style={{ color: d?.status === 'ACTIVE' ? '#16A34A' : '#DC2626' }}>{d?.status ?? '—'}</strong></span>
                  {imp.expiryDate && <><span>·</span><span>Expiry: <strong style={{ color: daysLeft !== null && daysLeft < 0 ? '#DC2626' : 'var(--text-dark)' }}>{fmtDate(imp.expiryDate)}</strong>{daysLeft !== null && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 20, background: daysLeft < 0 ? '#FEE2E2' : daysLeft <= 7 ? '#FEF3C7' : '#E0E7FF', color: daysLeft < 0 ? '#DC2626' : daysLeft <= 7 ? '#92400E' : '#3730A3', fontWeight: 800, fontSize: '0.68rem' }}>{daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'today' : `${daysLeft}d left`}</span>}</span></>}
                  {imp.ipConflict && pill('IP conflict', '#DC2626')}
                  {imp.needsMacAddress && pill('needs MAC', '#92400E')}
                  <Link href="/account" style={{ marginLeft: 'auto', color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>Edit & view all →</Link>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {coverage.length > 0 && (() => {
        const techCoverage = coverage.filter(c => (c.technology ?? 'FIBER') === coverageTech);
        const techCounts = { FIBER: coverage.filter(c => (c.technology ?? 'FIBER') === 'FIBER').length, RADIO: coverage.filter(c => (c.technology ?? 'FIBER') === 'RADIO').length };
        const ZONE_LABELS: Record<string, string> = {};
        for (const z of coverageZones) ZONE_LABELS[z.slug] = z.label;
        for (const c of coverage) if (c.zone && !ZONE_LABELS[c.zone]) ZONE_LABELS[c.zone] = formatZoneLabel(c.zone);
        const ZONES = coverageZones.length ? coverageZones.map((z) => z.slug) : Array.from(new Set(coverage.map((c) => c.zone).filter(Boolean) as string[])).sort((a, b) => (ZONE_LABELS[a] ?? a).localeCompare(ZONE_LABELS[b] ?? b));
        return (
        <div className="data-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{TECH_LABELS[coverageTech]} Coverage</div>
              <div className="badge-tabs" style={{ display: 'inline-flex' }}>
                {(['FIBER','RADIO'] as const).map(t => (
                  <button key={t} onClick={() => setCoverageTech(t)} className={`tab-item${coverageTech===t?' active':''}`} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: '0.72rem' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: TECH_COLORS[t] }} />{TECH_LABELS[t]} <span style={{ fontSize: '0.62rem', background: coverageTech===t? TECH_COLORS[t]: '#E2E8F0', color: coverageTech===t? '#fff':'#64748B', padding: '1px 6px', borderRadius: 10 }}>{techCounts[t]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                {techCoverage.filter(c => c.status === 'COVERED').length} areas covered · {techCoverage.length} total
              </span>
              <Link href="/coverage" style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>
                View all coverage →
              </Link>
            </div>
          </div>
          <div className="coverage-split" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: 16 }}>
            <CoverageMap areas={techCoverage} height={300} />
            <div style={{ maxHeight: 300, overflowY: 'auto', borderLeft: '1px solid var(--border-color)', paddingLeft: 16 }}>
              {ZONES.map(zone => {
                const items = techCoverage.filter(c => c.zone === zone);
                if (items.length === 0) return null;
                return (
                  <div key={zone} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{ZONE_LABELS[zone]}</div>
                    {items.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: '0.82rem' }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[c.status] ?? '#94A3B8', flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        {c.status !== 'COVERED' && <span style={{ marginLeft: 'auto', fontSize: '0.66rem', color: 'var(--text-muted)', flexShrink: 0 }}>{STATUS_LABELS[c.status]}</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
              {techCoverage.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '12px 0' }}>No {TECH_LABELS[coverageTech].toLowerCase()} areas yet.</div>}
            </div>
          </div>
        </div>
        );
      })()}

      <div className="grid-2" style={{ gap: 20 }}>
        <div className="data-card" style={{ padding: 20 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 14 }}>Quick Actions</div>
          <div className="grid-2" style={{ gap: 10 }}>
            {[
              { label: 'View Invoices', href: '/billing', icon: 'M1 5h22v14H1zM1 10h22' },
              { label: 'Make Payment', href: '/billing?tab=Payments', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
              { label: 'Open Ticket', href: '/support', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
              { label: 'Check Usage', href: '/internet', icon: 'M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M12 20h.01' },
            ].map((a) => (
              <div key={a.label} onClick={() => router.push(a.href)}
                style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.15s' }}
                onMouseOver={e => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={a.icon} /></svg>
                </span>
                <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{a.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="data-card" style={{ padding: 20 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 14 }}>Active Session</div>
          {d?.session?.isActive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span style={{ fontWeight: 600, color: '#16A34A' }}>Online</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Username</span>
                <span style={{ fontWeight: 600 }}>{d.session.username}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>IP Address</span>
                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{d.session.framedIpAddress}</span>
              </div>
              {d.session.acctStartTime && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Since</span>
                  <span style={{ fontWeight: 600 }}>{new Date(d.session.acctStartTime).toLocaleString()}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 0', color: 'var(--text-muted)' }}>
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>No active session</span>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {view === 'internet' && <InternetView />}
      {view === 'analytics' && <AnalyticsView />}
    </>
  );
}
