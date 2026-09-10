'use client';

import { useState, useEffect } from 'react';
import { api, apiUpload, formatNaira, nairaToKobo, koboToNairaInput } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../../../components/Skeleton';

interface Plan {
  id: string;
  name: string;
  type: string;
  technology: string;
  category: string;
  level: string | null;
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

interface ImportRow {
  row: number;
  name: string;
  status: 'created' | 'updated' | 'error';
  reason?: string;
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
  rows: ImportRow[];
}

const CATEGORY_OPTIONS = ['PERSONAL', 'HOME', 'SME', 'DIA_BRONZE', 'DIA_SILVER', 'DIA_GOLD', 'DIA_PLATINUM'];
const LEVEL_OPTIONS = ['BRONZE', 'SILVER', 'GOLD'];

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

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');

  const [form, setForm] = useState({
    name: '', type: 'RADIO', technology: 'RADIO', category: 'PERSONAL', level: '',
    speedMbps: 10, targetUsers: 1, priceNaira: '', installationFeeNaira: '',
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
    setForm({ name: '', type: 'RADIO', technology: 'RADIO', category: 'PERSONAL', level: '', speedMbps: 10, targetUsers: 1, priceNaira: '', installationFeeNaira: '', contentionRatio: '', staticIp: false, sla: 0, routerIncluded: false, description: '', features: '', dataCapGb: 0, fairUsageGb: 0 });
    setShowForm(true);
  }

  function openEdit(p: Plan) {
    setEditPlan(p);
    setForm({
      name: p.name, type: p.type, technology: p.technology, category: p.category, level: p.level ?? '',
      speedMbps: p.speedMbps, targetUsers: p.targetUsers ?? 1, priceNaira: koboToNairaInput(p.priceKobo),
      installationFeeNaira: koboToNairaInput(p.installationFeeKobo), contentionRatio: p.contentionRatio ?? '',
      staticIp: p.staticIp, sla: p.sla ?? 0, routerIncluded: p.routerIncluded,
      description: p.description ?? '', features: p.features ?? '',
      dataCapGb: p.dataCapGb ?? 0, fairUsageGb: p.fairUsageGb ?? 0,
    });
    setShowForm(true);
  }

  function openImport() {
    setImportFile(null);
    setImportResult(null);
    setImportError('');
    setShowImport(true);
  }

  async function handleImport() {
    if (!importFile) { setImportError('Choose an .xlsx, .xls or .csv file first'); return; }
    setImporting(true);
    setImportError('');
    try {
      const result = await apiUpload<ImportResult>('/subscriptions/plans/import', importFile);
      setImportResult(result);
      await fetchPlans();
    } catch (e: any) {
      setImportError(e?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const plansSheet = XLSX.utils.aoa_to_sheet([['Plan Name', 'Amount', 'Plan Type', 'Plan Level', 'Speed (Mbps)']]);
    plansSheet['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const instructions = XLSX.utils.aoa_to_sheet([
      ['Column', 'Required', 'Valid values / notes'],
      ['Plan Name', 'Yes', 'Any text, e.g. "Radio Bronze 10Mbps". If the name already exists, the plan is updated.'],
      ['Amount', 'Yes', 'Monthly price in Naira. Use a decimal point for kobo, e.g. 25000.50.'],
      ['Plan Type', 'Yes', 'radio, fiber or dedicated'],
      ['Plan Level', 'Yes', 'bronze, silver or gold'],
      ['Speed (Mbps)', 'No', 'Whole number, e.g. 50. Defaults to 0 if blank.'],
    ]);
    instructions['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 90 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, plansSheet, 'Plans');
    XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
    XLSX.writeFile(wb, 'plan-import-template.xlsx');
  }

  async function handleSave() {
    setSubmitting(true);
    try {
      const { priceNaira, installationFeeNaira, ...rest } = form;
      const body = { ...rest, priceKobo: nairaToKobo(priceNaira), installationFeeKobo: nairaToKobo(installationFeeNaira), level: form.level || null, dataCapGb: form.dataCapGb || null, fairUsageGb: form.fairUsageGb || null, contentionRatio: form.contentionRatio || null, sla: form.sla || null };
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
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-outline" onClick={downloadTemplate}>
            Download Template
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button className="btn-outline" onClick={openImport}>
            Import Excel
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <button className="btn-primary" onClick={openCreate}>
            Add Plan <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
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
                    {p.level && badge(p.level, p.level === 'GOLD' ? '#B45309' : p.level === 'SILVER' ? '#64748B' : '#92400E')}
                    {!p.isActive && badge('INACTIVE', '#94A3B8')}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{p.description}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--primary)' }}>{fmtKobo(p.priceKobo)}<span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>/mo</span></div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, padding: '16px 24px', background: '#FAFAFA', fontSize: '0.8rem' }}>
                <div><strong>{p.speedMbps} Mbps</strong> <span style={{ color: 'var(--text-muted)' }}>Speed</span></div>
                {p.sla ? <div><strong>{p.sla / 10}%</strong> <span style={{ color: 'var(--text-muted)' }}>SLA</span></div> : null}
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
                    {(CATEGORY_OPTIONS.includes(form.category) ? CATEGORY_OPTIONS : [form.category, ...CATEGORY_OPTIONS]).map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
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
                    <option value="RADIO">Radio</option>
                    <option value="FIBER">Fiber</option>
                    <option value="ENTERPRISE">Enterprise</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Level</label>
                <select value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))} style={sel}>
                  <option value="">—</option>
                  {LEVEL_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Monthly Price (₦)</label>
                  <input type="text" inputMode="decimal" value={form.priceNaira} onChange={e => setForm(f => ({ ...f, priceNaira: e.target.value }))} placeholder="e.g. 25000" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Installation Fee (₦)</label>
                  <input type="text" inputMode="decimal" value={form.installationFeeNaira} onChange={e => setForm(f => ({ ...f, installationFeeNaira: e.target.value }))} placeholder="e.g. 5000" style={inp} />
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

      {showImport && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowImport(false)}>
          <div style={{ background: 'white', padding: 32, width: 560, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Import Plans from Excel</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowImport(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>

            <div style={{ padding: '12px 16px', background: '#EFF6FF', color: '#1E40AF', borderRadius: 12, marginBottom: 16, fontSize: '0.8rem', lineHeight: 1.5 }}>
              Upload an <b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> file. The first row must be headers. Recognized columns (case-insensitive):
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                <li><b>Plan Name</b> — required</li>
                <li><b>Amount</b> — required, in Naira (use a decimal point for kobo, e.g. <b>25000.50</b>)</li>
                <li><b>Plan Type</b> — required: <b>radio</b>, <b>fiber</b> or <b>dedicated</b></li>
                <li><b>Plan Level</b> — required: <b>bronze</b>, <b>silver</b> or <b>gold</b></li>
                <li><b>Speed (Mbps)</b> — optional</li>
              </ul>
              Plans with an existing name are <b>updated</b>; new names are created.
            </div>

            <button className="btn-outline" onClick={downloadTemplate} style={{ marginBottom: 14 }}>
              Download Template (.xlsx)
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginLeft: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null); setImportError(''); }}
                style={{ ...inp, padding: '10px 12px' }}
              />

              {importError && (
                <div style={{ padding: '10px 14px', background: '#FEE2E2', color: '#DC2626', borderRadius: 10, fontSize: '0.85rem' }}>{importError}</div>
              )}

              {importResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ padding: '6px 14px', borderRadius: 16, background: '#16A34A18', color: '#16A34A', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.created} created</span>
                    <span style={{ padding: '6px 14px', borderRadius: 16, background: '#3B82F618', color: '#2563EB', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.updated} updated</span>
                    <span style={{ padding: '6px 14px', borderRadius: 16, background: '#DC262618', color: '#DC2626', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.errors} errors</span>
                    <span style={{ padding: '6px 14px', borderRadius: 16, background: '#E2E8F0', color: '#334155', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.total} rows</span>
                  </div>
                  {importResult.rows.some(r => r.status === 'error') && (
                    <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                          <tr style={{ background: '#F8FAFC' }}>
                            <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Row</th>
                            <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Plan</th>
                            <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importResult.rows.filter(r => r.status === 'error').map(r => (
                            <tr key={r.row} style={{ borderTop: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '8px 12px' }}>{r.row}</td>
                              <td style={{ padding: '8px 12px' }}>{r.name || '—'}</td>
                              <td style={{ padding: '8px 12px', color: '#DC2626' }}>{r.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowImport(false)}>Close</button>
                <button className="btn-primary" disabled={importing || !importFile} onClick={handleImport}>
                  {importing ? 'Importing...' : 'Import'}
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
