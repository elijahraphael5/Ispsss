'use client';

import { useEffect, useState } from 'react';
import { api } from '@isp/shared';

interface Profile {
  name: string;
  rateLimit: string | null;
  sessionTimeout: number | null;
  idleTimeout: number | null;
  framedPool: string | null;
  staticIpMode: boolean;
  users: number;
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' };

export default function ProfilesTab({ toast }: { toast: (msg: string) => void }) {
  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', rateLimit: '', sessionTimeout: '', idleTimeout: '', framedPool: '', staticIpMode: false });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(await api<Profile[]>('/radius/profiles'));
    } catch (e: any) {
      toast(e?.message ?? 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditName(null);
    setForm({ name: '', rateLimit: '', sessionTimeout: '', idleTimeout: '', framedPool: '', staticIpMode: false });
    setShowForm(true);
  }

  function openEdit(p: Profile) {
    setEditName(p.name);
    setForm({
      name: p.name,
      rateLimit: p.rateLimit ?? '',
      sessionTimeout: p.sessionTimeout !== null ? String(p.sessionTimeout) : '',
      idleTimeout: p.idleTimeout !== null ? String(p.idleTimeout) : '',
      framedPool: p.framedPool ?? '',
      staticIpMode: p.staticIpMode,
    });
    setShowForm(true);
  }

  async function save() {
    if (!editName && !/^[A-Za-z0-9_.-]+$/.test(form.name.trim())) {
      toast('Profile name may only contain letters, numbers, dot, dash and underscore');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        rateLimit: form.rateLimit.trim() || undefined,
        sessionTimeout: form.sessionTimeout === '' ? undefined : Number(form.sessionTimeout),
        idleTimeout: form.idleTimeout === '' ? undefined : Number(form.idleTimeout),
        framedPool: form.framedPool.trim() || undefined,
        staticIpMode: form.staticIpMode,
      };
      if (editName) {
        const res = await api<Profile & { removedStaticIps?: number }>(`/radius/profiles/${encodeURIComponent(editName)}`, { method: 'PATCH', body: JSON.stringify(body) });
        if ((res.removedStaticIps ?? 0) > 0) {
          toast(`Profile saved — static IPs are no longer applied to ${res.removedStaticIps} customer(s); their stored IPs are flagged unused.`);
        } else {
          toast('Profile updated');
        }
      } else {
        await api('/radius/profiles', { method: 'POST', body: JSON.stringify({ ...body, name: form.name.trim() }) });
        toast('Profile created');
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Profile) {
    if (!confirm(`Delete profile "${p.name}"?`)) return;
    try {
      await api(`/radius/profiles/${encodeURIComponent(p.name)}`, { method: 'DELETE' });
      setRows((prev) => prev.filter((r) => r.name !== p.name));
      toast('Profile deleted');
    } catch (e: any) {
      if (p.users > 0 && confirm(`${e?.message ?? 'Profile is assigned to customers.'}\n\nUnassign ${p.users} customer(s) and delete anyway?`)) {
        try {
          await api(`/radius/profiles/${encodeURIComponent(p.name)}?force=true`, { method: 'DELETE' });
          setRows((prev) => prev.filter((r) => r.name !== p.name));
          toast('Profile deleted and customers unassigned');
        } catch (err: any) {
          toast(err?.message ?? 'Failed to delete profile');
        }
      }
    }
  }

  return (
    <>
      <div className="data-card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            PPPoE profiles stored as RADIUS groups (<code>radgroupreply</code>). Assign them per user from the PPPoE Users tab.
          </span>
          <button className="btn-primary" onClick={openCreate} style={{ flexShrink: 0 }}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Profile
          </button>
        </div>
      </div>

      <div className="data-card" style={{ padding: 0 }}>
        <div className="table-container">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>PROFILE</th>
                  <th>RATE LIMIT</th>
                  <th>SESSION TIMEOUT</th>
                  <th>IDLE TIMEOUT</th>
                  <th>IP POOL</th>
                  <th>STATIC IP</th>
                  <th>USERS</th>
                  <th style={{ width: 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                      <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                      <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>No profiles yet</span>
                      <span style={{ fontSize: '0.78rem' }}>Create a PPPoE profile to assign to your customers.</span>
                    </div>
                  </td></tr>
                ) : rows.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.rateLimit ?? '—'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{p.sessionTimeout !== null ? `${p.sessionTimeout}s` : '—'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{p.idleTimeout !== null ? `${p.idleTimeout}s` : '—'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{p.framedPool ?? '—'}</td>
                    <td>
                      {p.staticIpMode
                        ? <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#6366F118', color: '#4F46E5' }}>Static</span>
                        : <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#F1F5F9', color: '#64748B' }}>Dynamic</span>}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{p.users}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn-sm-outline" onClick={() => openEdit(p)}>Edit</button>
                        <button className="btn-sm-outline" style={{ color: '#DC2626', borderColor: '#DC2626' }} onClick={() => remove(p)}>Delete</button>
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
          <div style={{ background: 'white', padding: 32, width: 520, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{editName ? 'Edit Profile' : 'Add Profile'}</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowForm(false)}>✕</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {!editName && (
                <div>
                  <label style={lbl}>Profile name</label>
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="FIBER_10M" style={inp} />
                </div>
              )}
              <div>
                <label style={lbl}>Rate limit (Mikrotik-Rate-Limit)</label>
                <input value={form.rateLimit} onChange={(e) => setForm((f) => ({ ...f, rateLimit: e.target.value }))} placeholder="10M/10M" style={{ ...inp, fontFamily: 'monospace' }} />
              </div>
              <div className="grid-2" style={{ gap: 12 }}>
                <div>
                  <label style={lbl}>Session timeout (seconds)</label>
                  <input type="number" value={form.sessionTimeout} onChange={(e) => setForm((f) => ({ ...f, sessionTimeout: e.target.value }))} placeholder="optional" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Idle timeout (seconds)</label>
                  <input type="number" value={form.idleTimeout} onChange={(e) => setForm((f) => ({ ...f, idleTimeout: e.target.value }))} placeholder="optional" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Framed pool / IP pool</label>
                <input value={form.framedPool} onChange={(e) => setForm((f) => ({ ...f, framedPool: e.target.value }))} placeholder="optional, e.g. pool-fiber" style={inp} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                <input type="checkbox" checked={form.staticIpMode} onChange={(e) => setForm((f) => ({ ...f, staticIpMode: e.target.checked }))} style={{ width: 16, height: 16 }} />
                Static IP mode — customers on this profile must have a fixed 192.x Framed-IP-Address
              </label>
              {editName && form.staticIpMode === false && (
                <p style={{ fontSize: '0.78rem', color: '#B45309', background: '#FEF3C7', padding: '10px 14px', borderRadius: 10, margin: 0 }}>
                  Turning static IP mode off stops applying any existing Framed-IP-Address. The stored customer IPs are kept but flagged as unused.
                </p>
              )}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : editName ? 'Save Changes' : 'Create Profile'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
