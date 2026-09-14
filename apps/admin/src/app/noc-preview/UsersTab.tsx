'use client';

import { useEffect, useMemo, useState } from 'react';
import { Profile, PppoeUser, PppoeUserInput, PppoeUserStatus, validateStaticIp } from './api';
import { useNocApi } from './NocApiContext';

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' };
const errText: React.CSSProperties = { fontSize: '0.75rem', color: '#DC2626', margin: '4px 0 0' };

function StatusPill({ status }: { status: PppoeUserStatus }) {
  return status === 'active'
    ? <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#16A34A18', color: '#16A34A' }}>Active</span>
    : <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#F59E0B18', color: '#B45309' }}>Suspended</span>;
}

export default function UsersTab({ toast }: { toast: (msg: string) => void }) {
  const client = useNocApi();
  const [rows, setRows] = useState<PppoeUser[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<{ username: string; profile: string; framedIpAddress: string; status: PppoeUserStatus }>({ username: '', profile: '', framedIpAddress: '', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [ipCheck, setIpCheck] = useState<{ checking: boolean; error: string | null }>({ checking: false, error: null });

  const profileByName = useMemo(() => Object.fromEntries(profiles.map((p) => [p.name, p])), [profiles]);
  const selectedProfile = form.profile ? profileByName[form.profile] : undefined;
  const staticMode = !!selectedProfile?.staticIpMode;
  const formatError = form.framedIpAddress.trim() ? validateStaticIp(form.framedIpAddress) : null;

  async function load() {
    setLoading(true);
    try {
      const [users, profileRows] = await Promise.all([client.listUsers(), client.listProfiles()]);
      setRows(users);
      setProfiles(profileRows);
    } catch (e: any) {
      toast(e?.message ?? 'Failed to load PPPoE users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!showForm || !staticMode) {
      setIpCheck({ checking: false, error: null });
      return;
    }
    const ip = form.framedIpAddress.trim();
    if (!ip || validateStaticIp(ip)) {
      setIpCheck({ checking: false, error: null });
      return;
    }
    let active = true;
    setIpCheck({ checking: true, error: null });
    const timer = setTimeout(async () => {
      try {
        const res = await client.checkStaticIp(ip, editId ?? undefined);
        if (!active) return;
        setIpCheck({ checking: false, error: res.available ? null : `Static IP ${ip} is already applied to PPPoE user ${res.usedBy}` });
      } catch {
        if (active) setIpCheck({ checking: false, error: null });
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [form.framedIpAddress, staticMode, showForm, editId, client]);

  function openCreate() {
    setEditId(null);
    setForm({ username: '', profile: profiles[0]?.name ?? '', framedIpAddress: '', status: 'active' });
    setIpCheck({ checking: false, error: null });
    setShowForm(true);
  }

  function openEdit(u: PppoeUser) {
    setEditId(u.id);
    setForm({ username: u.username, profile: u.profile ?? '', framedIpAddress: u.framedIpAddress ?? '', status: u.status });
    setIpCheck({ checking: false, error: null });
    setShowForm(true);
  }

  async function save() {
    if (!editId && !form.username.trim()) { toast('Username is required'); return; }
    if (staticMode) {
      const ip = form.framedIpAddress.trim();
      if (!ip) { toast('Framed-IP-Address is required for static IP profiles'); return; }
      const err = validateStaticIp(ip);
      if (err) { toast(err); return; }
      if (ipCheck.checking) { toast('Checking static IP availability…'); return; }
      if (ipCheck.error) { toast(ipCheck.error); return; }
    }
    setSaving(true);
    try {
      const body: PppoeUserInput = {
        username: form.username.trim(),
        profile: form.profile || null,
        framedIpAddress: form.framedIpAddress.trim() || null,
        status: form.status,
      };
      if (editId) await client.updateUser(editId, body);
      else await client.createUser(body);
      setShowForm(false);
      await load();
      toast(editId ? 'PPPoE user updated' : 'PPPoE user added');
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save PPPoE user');
    } finally {
      setSaving(false);
    }
  }

  async function remove(u: PppoeUser) {
    if (!confirm(`Delete PPPoE user "${u.username}"? The RADIUS credentials will stop working.`)) return;
    try {
      await client.deleteUser(u.id);
      setRows((prev) => prev.filter((r) => r.id !== u.id));
      toast('PPPoE user deleted');
    } catch (e: any) {
      toast(e?.message ?? 'Failed to delete PPPoE user');
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
          PPPoE users backed by <code>radcheck</code>/<code>radreply</code>. Framed-IP-Address is only applied when the assigned profile has static IP mode.
        </p>
        <button className="btn-primary" onClick={openCreate}>Add PPPoE User</button>
      </div>

      <div className="data-card" style={{ padding: 0 }}>
        <div className="table-container">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>USERNAME</th>
                  <th>PROFILE</th>
                  <th>FRAMED-IP-ADDRESS</th>
                  <th>STATUS</th>
                  <th style={{ width: 140 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No PPPoE users yet.</td></tr>
                ) : rows.map((u) => {
                  const assigned = u.profile ? profileByName[u.profile] : undefined;
                  const unused = !!u.framedIpAddress && !!assigned && !assigned.staticIpMode;
                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.username}</td>
                      <td style={{ fontSize: '0.85rem' }}>{u.profile ?? '—'}</td>
                      <td>
                        {u.framedIpAddress ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <code style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{u.framedIpAddress}</code>
                            {unused && <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: '0.65rem', fontWeight: 600, background: '#FEF3C7', color: '#B45309' }}>unused</span>}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td><StatusPill status={u.status} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-sm-outline" onClick={() => openEdit(u)}>Edit</button>
                          <button className="btn-sm-outline" style={{ color: '#DC2626', borderColor: '#DC2626' }} onClick={() => remove(u)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{editId ? 'Edit PPPoE User' : 'Add PPPoE User'}</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowForm(false)}>✕</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Username</label>
                <input
                  value={form.username}
                  disabled={!!editId}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="ppp_customer01"
                  style={{ ...inp, background: editId ? '#F8FAFC' : 'white', fontFamily: 'monospace' }}
                />
                {editId && <p style={{ ...errText, color: 'var(--text-muted)' }}>PPPoE usernames are immutable — RADIUS credentials are keyed on this value.</p>}
              </div>
              <div>
                <label style={lbl}>Profile</label>
                <select value={form.profile} onChange={(e) => setForm((f) => ({ ...f, profile: e.target.value }))} style={{ ...inp, background: 'white' }}>
                  <option value="">— No profile —</option>
                  {profiles.map((p) => (
                    <option key={p.name} value={p.name}>{p.name} — {p.staticIpMode ? 'Static' : 'Dynamic'}</option>
                  ))}
                </select>
                {selectedProfile && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    {selectedProfile.staticIpMode
                      ? 'Static IP mode — a fixed 192.x Framed-IP-Address is required.'
                      : 'Dynamic profile — the router assigns the IP from its pool.'}
                  </p>
                )}
              </div>
              {staticMode && (
                <div>
                  <label style={lbl}>Framed-IP-Address</label>
                  <input
                    value={form.framedIpAddress}
                    onChange={(e) => setForm((f) => ({ ...f, framedIpAddress: e.target.value }))}
                    placeholder="192.168.10.15"
                    style={{ ...inp, fontFamily: 'monospace', borderColor: formatError || ipCheck.error ? '#DC2626' : 'var(--border-color)' }}
                  />
                  {formatError ? (
                    <p style={errText}>{formatError}</p>
                  ) : ipCheck.checking ? (
                    <p style={{ ...errText, color: 'var(--text-muted)' }}>Checking availability…</p>
                  ) : ipCheck.error ? (
                    <p style={errText}>{ipCheck.error}</p>
                  ) : (
                    <p style={{ fontSize: '0.75rem', color: '#16A34A', margin: '4px 0 0' }}>Static IP available.</p>
                  )}
                </div>
              )}
              {!staticMode && form.framedIpAddress.trim() && (
                <p style={{ fontSize: '0.78rem', color: '#B45309', background: '#FEF3C7', padding: '10px 14px', borderRadius: 10, margin: 0 }}>
                  This profile is dynamic — Framed-IP-Address will stop applying to this user. The stored IP is kept but flagged as unused.
                </p>
              )}
              <div>
                <label style={lbl}>Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PppoeUserStatus }))} style={{ ...inp, background: 'white' }}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={saving || ipCheck.checking} onClick={save}>{saving ? 'Saving…' : editId ? 'Save Changes' : 'Add User'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
