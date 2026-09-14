'use client';

import { useEffect, useState } from 'react';
import { Nas, NasInput, NasTestResult } from './api';
import { useNocApi } from './NocApiContext';

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' };

function StatusBadge({ result }: { result?: NasTestResult }) {
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
  const client = useNocApi();
  const [rows, setRows] = useState<Nas[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ nasname: '', shortname: '', type: 'mikrotik', ports: 1812, secret: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, NasTestResult>>({});
  const [confirmReveal, setConfirmReveal] = useState<Nas | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [revealingId, setRevealingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await client.listNas());
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
    if (editId && form.secret && form.secret.length < 8) { toast('Shared secret must be at least 8 characters'); return; }
    setSaving(true);
    try {
      const body: NasInput = {
        nasname: form.nasname.trim(),
        shortname: form.shortname.trim() || undefined,
        type: form.type,
        ports: Number(form.ports) || 1812,
        description: form.description.trim() || undefined,
      };
      if (form.secret) body.secret = form.secret;
      if (editId) await client.updateNas(editId, body);
      else await client.createNas(body);
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
      await client.deleteNas(n.id);
      setRows((prev) => prev.filter((r) => r.id !== n.id));
      toast('NAS deleted');
    } catch (e: any) {
      toast(e?.message ?? 'Failed to delete NAS');
    }
  }

  async function test(n: Nas) {
    setTesting((t) => ({ ...t, [n.id]: true }));
    try {
      const res = await client.testNas(n.id);
      setResults((r) => ({ ...r, [n.id]: res }));
      setRows((prev) => prev.map((row) => (row.id === n.id ? { ...row, lastTest: res } : row)));
      toast(res.message);
    } catch (e: any) {
      toast(e?.message ?? 'Connection test failed');
    } finally {
      setTesting((t) => ({ ...t, [n.id]: false }));
    }
  }

  async function reveal(n: Nas) {
    setConfirmReveal(null);
    setRevealingId(n.id);
    try {
      const res = await client.revealNasSecret(n.id);
      setRevealed((r) => ({ ...r, [n.id]: res.secret }));
    } catch (e: any) {
      toast(e?.message ?? 'Failed to reveal secret');
    } finally {
      setRevealingId(null);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
          RADIUS clients (routers) read by FreeRADIUS from the <code>nas</code> table. Secrets are masked by default.
        </p>
        <button className="btn-primary" onClick={openCreate}>Add NAS</button>
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
                  <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No NAS entries yet — add your router to enable SQL-based clients.</td></tr>
                ) : rows.map((n) => (
                  <tr key={n.id}>
                    <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{n.shortname ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{n.nasname}</td>
                    <td style={{ fontSize: '0.85rem' }}>{n.type ?? 'other'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{n.ports ?? 1812}</td>
                    <td>
                      {revealed[n.id] ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <code style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{revealed[n.id]}</code>
                          <button className="btn-sm-outline" style={{ padding: '2px 8px' }} onClick={() => setRevealed((r) => { const next = { ...r }; delete next[n.id]; return next; })}>Hide</button>
                        </div>
                      ) : revealingId === n.id ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Revealing…</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{n.secretMasked}</span>
                          <button className="btn-sm-outline" style={{ padding: '2px 8px' }} onClick={() => setConfirmReveal(n)}>Reveal</button>
                        </div>
                      )}
                    </td>
                    <td><StatusBadge result={results[n.id] ?? n.lastTest} /></td>
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
                The secret must match the secret configured on the router. In production it is write-only and never returned by the API.
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Add NAS'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmReveal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setConfirmReveal(null)}>
          <div style={{ background: 'white', padding: 28, borderRadius: 16, width: 420, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 8 }}>Reveal shared secret?</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20 }}>
              You are about to reveal the shared secret for <strong>{confirmReveal.shortname ?? confirmReveal.nasname}</strong>.
              In production this is a security-sensitive action and would be restricted and audit-logged.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn-outline" onClick={() => setConfirmReveal(null)}>Cancel</button>
              <button className="btn-primary" onClick={() => reveal(confirmReveal)}>Reveal secret</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
