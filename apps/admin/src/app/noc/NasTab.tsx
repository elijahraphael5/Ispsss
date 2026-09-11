'use client';

import { useEffect, useState } from 'react';
import { api } from '@isp/shared';

interface Nas {
  id: number;
  nasname: string;
  shortname: string | null;
  type: string | null;
  ports: number | null;
  description: string | null;
  hasSecret: boolean;
  secretMasked: string;
}

interface TestResult {
  reachable: boolean;
  networkStatus: 'reachable' | 'unreachable' | 'no-response';
  latencyMs: number | null;
  accountingReachable: boolean;
  authStatus: 'accept' | 'reject' | 'no-response' | 'error';
  authLatencyMs: number | null;
  radiusServer: string;
  message: string;
  checkedAt: string;
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' };

function StatusBadge({ result }: { result?: TestResult }) {
  if (!result) return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#F1F5F9', color: '#64748B' }}>Unknown</span>;
  if (result.networkStatus === 'reachable') {
    return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#16A34A18', color: '#16A34A' }}>Reachable{result.latencyMs !== null ? ` · ${result.latencyMs}ms` : ''}</span>;
  }
  if (result.networkStatus === 'unreachable') {
    return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#DC262618', color: '#DC2626' }}>Unreachable</span>;
  }
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#F59E0B18', color: '#B45309' }}>No response</span>;
}

export default function NasTab({ toast }: { toast: (msg: string) => void }) {
  const [rows, setRows] = useState<Nas[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ nasname: '', shortname: '', type: 'mikrotik', ports: 1812, secret: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, TestResult>>({});

  async function load() {
    setLoading(true);
    try {
      setRows(await api<Nas[]>('/radius/nas'));
    } catch (e: any) {
      toast(e?.message ?? 'Failed to load NAS entries');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditId(null);
    setForm({ nasname: '', shortname: '', type: 'mikrotik', ports: 1812, secret: '', description: '' });
    setShowForm(true);
  }

  function openEdit(n: Nas) {
    setEditId(n.id);
    setForm({ nasname: n.nasname, shortname: n.shortname ?? '', type: n.type ?? 'other', ports: n.ports ?? 1812, secret: '', description: n.description ?? '' });
    setShowForm(true);
  }

  async function save() {
    if (!form.nasname.trim()) { toast('NAS IP / hostname is required'); return; }
    if (!editId && form.secret.length < 8) { toast('Shared secret must be at least 8 characters'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        nasname: form.nasname.trim(),
        shortname: form.shortname.trim() || undefined,
        type: form.type,
        ports: Number(form.ports) || 1812,
        description: form.description.trim() || undefined,
      };
      if (form.secret) body.secret = form.secret;
      if (editId) await api(`/radius/nas/${editId}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/radius/nas', { method: 'POST', body: JSON.stringify(body) });
      setShowForm(false);
      await load();
      toast(editId ? 'NAS updated' : 'NAS added');
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save NAS');
    } finally {
      setSaving(false);
    }
  }

  async function remove(n: Nas) {
    if (!confirm(`Delete NAS "${n.shortname ?? n.nasname}"? Routers using it will stop authenticating.`)) return;
    try {
      await api(`/radius/nas/${n.id}`, { method: 'DELETE' });
      setRows((prev) => prev.filter((r) => r.id !== n.id));
      toast('NAS deleted');
    } catch (e: any) {
      toast(e?.message ?? 'Failed to delete NAS');
    }
  }

  async function test(n: Nas) {
    setTesting((t) => ({ ...t, [n.id]: true }));
    try {
      const res = await api<TestResult>(`/radius/nas/${n.id}/test`, { method: 'POST', body: '{}' });
      setResults((r) => ({ ...r, [n.id]: res }));
      toast(res.message);
    } catch (e: any) {
      toast(e?.message ?? 'Connection test failed');
    } finally {
      setTesting((t) => ({ ...t, [n.id]: false }));
    }
  }

  return (
    <>
      <div className="data-card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            RADIUS clients (routers) read by FreeRADIUS from the <code>nas</code> table. Secrets are masked.
          </span>
          <button className="btn-primary" onClick={openCreate} style={{ flexShrink: 0 }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add NAS
          </button>
        </div>
      </div>

      <div className="data-card" style={{ padding: 0 }}>
        <div className="table-container">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>SHORTNAME</th>
                  <th>NAS IP</th>
                  <th>TYPE</th>
                  <th>PORT</th>
                  <th>SECRET</th>
                  <th>STATUS</th>
                  <th style={{ width: 220 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                      <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 14V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                      <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>No NAS entries yet</span>
                      <span style={{ fontSize: '0.78rem' }}>Add your router to enable SQL-based clients.</span>
                    </div>
                  </td></tr>
                ) : rows.map((n) => (
                  <tr key={n.id}>
                    <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{n.shortname ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{n.nasname}</td>
                    <td style={{ fontSize: '0.85rem' }}>{n.type ?? 'other'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{n.ports ?? 1812}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{n.secretMasked}</td>
                    <td><StatusBadge result={results[n.id]} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-sm" disabled={testing[n.id]} onClick={() => test(n)}>
                          {testing[n.id] ? 'Testing…' : 'Test'}
                        </button>
                        <button className="btn-sm-outline" onClick={() => openEdit(n)}>Edit</button>
                        <button className="btn-sm-outline" style={{ color: '#DC2626', borderColor: '#DC2626' }} onClick={() => remove(n)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowForm(false)}>
          <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{editId ? 'Edit NAS' : 'Add NAS'}</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowForm(false)}>✕</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>NAS IP / hostname</label>
                <input value={form.nasname} onChange={(e) => setForm((f) => ({ ...f, nasname: e.target.value }))} placeholder="203.0.113.10" style={inp} />
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div>
                  <label style={lbl}>Shortname</label>
                  <input value={form.shortname} onChange={(e) => setForm((f) => ({ ...f, shortname: e.target.value }))} placeholder="mtk-main" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Type</label>
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} style={{ ...inp, background: 'white' }}>
                    <option value="mikrotik">mikrotik</option>
                    <option value="other">other</option>
                  </select>
                </div>
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div>
                  <label style={lbl}>Auth port</label>
                  <input type="number" value={form.ports} onChange={(e) => setForm((f) => ({ ...f, ports: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Shared secret {editId ? '(blank = keep current)' : ''}</label>
                  <input type="password" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} placeholder={editId ? '••••••••' : 'at least 8 characters'} style={inp} autoComplete="new-password" />
                </div>
              </div>
              <div>
                <label style={lbl}>Description</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Main NAS" style={inp} />
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                The secret is stored write-only and never returned by the API. It must match the secret configured on the router.
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Add NAS'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
