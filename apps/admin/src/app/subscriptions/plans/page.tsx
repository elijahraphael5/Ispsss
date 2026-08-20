'use client';

import { useState, useEffect } from 'react';
import { api, formatNaira } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../../../components/Skeleton';

interface Plan {
  id: string;
  name: string;
  type: string;
  technology: string;
  category: string;
  speedMbps: number;
  targetUsers: number | null;
  dataCapGb: number | null;
  fairUsageGb: number | null;
  priceKobo: number;
  installationFeeKobo: number;
  contentionRatio: string | null;
  staticIp: boolean;
  sla: number | null;
  routerIncluded: boolean;
  contractDuration: number | null;
  description: string | null;
  features: string | null;
  isActive: boolean;
  createdAt: string;
}

const CATEGORY_OPTIONS = ['PERSONAL', 'HOME', 'SME', 'DIA_BRONZE', 'DIA_SILVER', 'DIA_GOLD', 'DIA_PLATINUM'];

function fmtKobo(k: number) { return k ? formatNaira(k) : 'On request'; }

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '20', color }}>{label}</span>;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '', type: 'UNLIMITED', technology: 'RADIO', category: 'PERSONAL',
    speedMbps: 10, targetUsers: 1, priceKobo: 0, installationFeeKobo: 0,
    contentionRatio: '', staticIp: false, sla: 0, routerIncluded: false,
    description: '', features: '', dataCapGb: 0, fairUsageGb: 0,
  });

  useEffect(() => { fetchPlans(); }, []);

  async function fetchPlans() {
    setLoading(true);
    try {
      const data = await api<Plan[]>('/subscriptions/plans');
      setPlans(data);
    } catch { setError('Failed to load plans'); }
    finally { setLoading(false); }
  }

  function openCreate() {
    setEditPlan(null);
    setForm({ name: '', type: 'UNLIMITED', technology: 'RADIO', category: 'PERSONAL', speedMbps: 10, targetUsers: 1, priceKobo: 0, installationFeeKobo: 0, contentionRatio: '', staticIp: false, sla: 0, routerIncluded: false, description: '', features: '', dataCapGb: 0, fairUsageGb: 0 });
    setShowForm(true);
  }

  function openEdit(p: Plan) {
    setEditPlan(p);
    setForm({
      name: p.name, type: p.type, technology: p.technology, category: p.category,
      speedMbps: p.speedMbps, targetUsers: p.targetUsers ?? 1, priceKobo: p.priceKobo,
      installationFeeKobo: p.installationFeeKobo, contentionRatio: p.contentionRatio ?? '',
      staticIp: p.staticIp, sla: p.sla ?? 0, routerIncluded: p.routerIncluded,
      description: p.description ?? '', features: p.features ?? '',
      dataCapGb: p.dataCapGb ?? 0, fairUsageGb: p.fairUsageGb ?? 0,
    });
    setShowForm(true);
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      const body = { ...form, dataCapGb: form.dataCapGb || null, fairUsageGb: form.fairUsageGb || null, contentionRatio: form.contentionRatio || null, sla: form.sla || null };
      if (editPlan) {
        await api(`/subscriptions/plans/${editPlan.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/subscriptions/plans', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      await fetchPlans();
    } catch { setError('Failed to save plan'); }
    finally { setSubmitting(false); }
  }

  async function toggleActive(p: Plan) {
    try {
      await api(`/subscriptions/plans/${p.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !p.isActive }) });
      await fetchPlans();
    } catch { setError('Failed to update plan'); }
  }

  const filtered = plans;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SkeletonBlock width={200} height={28} />
          <SkeletonBlock width={130} height={40} borderRadius={20} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} width={120} height={34} borderRadius={20} />)}
        </div>
        <SkeletonCard height={120} />
        <SkeletonCard height={120} />
        <SkeletonCard height={120} />
      </div>
    );
  }

  return (
    <>
      <div className="page-title-row">
        <h1 className="page-title">Package</h1>
        <button className="btn-primary" onClick={openCreate}>
          Add Plan <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 600 }}>Dismiss</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4 }}>No plans found</p>
          <p style={{ fontSize: '0.85rem' }}>Click "Add Plan" to create the first plan.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filtered.map(p => (
            <div key={p.id} className="data-card" style={{ padding: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px', borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>{p.name}</h3>
                    {badge(p.technology, p.technology === 'FIBER' ? '#8B5CF6' : p.technology === 'DIA' ? '#DC2626' : '#F59E0B')}
                    {badge(p.category.replace(/_/g, ' '), '#3B82F6')}
                    {!p.isActive && badge('INACTIVE', '#94A3B8')}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{p.description}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--primary)' }}>{fmtKobo(p.priceKobo)}<span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>/mo</span></div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fmtKobo(p.installationFeeKobo)} installation</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, padding: '16px 24px', background: '#FAFAFA', fontSize: '0.8rem' }}>
                <div><strong>{p.speedMbps} Mbps</strong> <span style={{ color: 'var(--text-muted)' }}>Speed</span></div>
                <div><strong>{p.targetUsers ? `Up to ${p.targetUsers}` : 'Unlimited'}</strong> <span style={{ color: 'var(--text-muted)' }}>Users</span></div>
                <div><strong>{p.dataCapGb ? `${p.dataCapGb} GB` : 'Unlimited'}</strong> <span style={{ color: 'var(--text-muted)' }}>Data</span></div>
                <div><strong>{p.staticIp ? 'Yes' : 'Dynamic'}</strong> <span style={{ color: 'var(--text-muted)' }}>IP</span></div>
                <div><strong>{p.routerIncluded ? 'Included' : 'Optional'}</strong> <span style={{ color: 'var(--text-muted)' }}>Router</span></div>
                {p.sla ? <div><strong>{p.sla / 10}%</strong> <span style={{ color: 'var(--text-muted)' }}>SLA</span></div> : null}
                {p.contentionRatio ? <div><strong>{p.contentionRatio}</strong> <span style={{ color: 'var(--text-muted)' }}>Contention</span></div> : null}
              </div>
              {p.features && (
                <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(JSON.parse(p.features) as string[]).map((f, i) => (
                    <span key={i} style={{ padding: '3px 10px', borderRadius: 8, background: '#F1F5F9', fontSize: '0.75rem', color: '#475569' }}>{f}</span>
                  ))}
                </div>
              )}
              <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => toggleActive(p)} style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500 }}>
                  {p.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => openEdit(p)} style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 500 }}>
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowForm(false)}>
          <div style={{ background: 'white', padding: 32, width: 520, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{editPlan ? 'Edit' : 'Add'} Plan</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowForm(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Plan Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Home Gold" style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Technology</label>
                  <select value={form.technology} onChange={e => setForm(f => ({ ...f, technology: e.target.value }))} style={sel}>
                    {['RADIO', 'FIBER', 'DIA'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={sel}>
                    {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Speed (Mbps)</label>
                  <input type="number" value={form.speedMbps} onChange={e => setForm(f => ({ ...f, speedMbps: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Max Users</label>
                  <input type="number" value={form.targetUsers} onChange={e => setForm(f => ({ ...f, targetUsers: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={sel}>
                    <option value="UNLIMITED">Unlimited</option>
                    <option value="CAPPED">Capped</option>
                    <option value="DIA">DIA</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Monthly Price (kobo)</label>
                  <input type="number" value={form.priceKobo} onChange={e => setForm(f => ({ ...f, priceKobo: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Installation Fee (kobo)</label>
                  <input type="number" value={form.installationFeeKobo} onChange={e => setForm(f => ({ ...f, installationFeeKobo: Number(e.target.value) }))} style={inp} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Data Cap (GB)</label>
                  <input type="number" value={form.dataCapGb} onChange={e => setForm(f => ({ ...f, dataCapGb: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Fair Usage (GB)</label>
                  <input type="number" value={form.fairUsageGb} onChange={e => setForm(f => ({ ...f, fairUsageGb: Number(e.target.value) }))} style={inp} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Contention Ratio</label>
                  <input value={form.contentionRatio} onChange={e => setForm(f => ({ ...f, contentionRatio: e.target.value }))} placeholder="e.g. 1:1" style={inp} />
                </div>
                <div>
                  <label style={lbl}>SLA (%)</label>
                  <input type="number" value={form.sla} onChange={e => setForm(f => ({ ...f, sla: Number(e.target.value) }))} placeholder="e.g. 999 for 99.9%" style={inp} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                  <input type="checkbox" checked={form.staticIp} onChange={e => setForm(f => ({ ...f, staticIp: e.target.checked }))} />
                  Static IP
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                  <input type="checkbox" checked={form.routerIncluded} onChange={e => setForm(f => ({ ...f, routerIncluded: e.target.checked }))} />
                  Router Included
                </label>
              </div>
              <div>
                <label style={lbl}>Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description of the plan" style={inp} />
              </div>
              <div>
                <label style={lbl}>Features (JSON array)</label>
                <input value={form.features} onChange={e => setForm(f => ({ ...f, features: e.target.value }))} placeholder='["Feature 1","Feature 2"]' style={inp} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={submitting || !form.name} onClick={handleSave}>
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none' };
const sel: React.CSSProperties = { ...inp, background: 'white' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' };
