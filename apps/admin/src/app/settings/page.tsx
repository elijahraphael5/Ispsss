'use client';

import { useState, useEffect } from 'react';
import { api, useAuthStore } from '@isp/shared';
import { useToast, ToastContainer } from '../../components/Toast';

interface UserItem {
  id: string;
  email: string;
  isSuperAdmin?: boolean;
  phone: string | null;
  createdAt: string;
  deletedAt: string | null;
  customRoleId?: string | null;
  customRole?: { id: string; name: string } | null;
}

interface CustomRoleFull {
  id: string;
  name: string;
  permissions: { module: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }[];
  _count?: { users: number };
}

interface Permission {
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const MODULES = ['Dashboard', 'User Control', 'Customer', 'Package', 'Billing', 'Payments', 'Support', 'NOC', 'Notifications', 'Audit Logs', 'Owner', 'Settings'];
const PERM_LABELS: Record<string, string> = { canView: 'View', canCreate: 'Create', canEdit: 'Edit', canDelete: 'Delete' };

const TABS = ['Admin Users', 'Roles', 'Security', 'Launch'];

function ToggleBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', border: 'none', position: 'relative', backgroundColor: on ? '#F15925' : '#d1d5db', transition: 'background 0.2s' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: '#fff', position: 'absolute', top: 2, left: on ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </button>
  );
}

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

export default function SettingsPage() {
  const { user: currentUser, accessToken } = useAuthStore();
  const { toast } = useToast();
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
  const [tab, setTab] = useState('Admin Users');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<CustomRoleFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [launchResult, setLaunchResult] = useState<any>(null);
  const [launchConfirm, setLaunchConfirm] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([
      api<UserItem[]>('/users'),
      api<CustomRoleFull[]>('/custom-roles'),
    ]).then(([u, r]) => {
      setUsers(u.filter(u => !u.deletedAt && (u.isSuperAdmin || (u.customRole && u.customRole.name !== 'CUSTOMER'))));
      setRoles(r);
    }).catch(e => setError(e.message || 'Failed to load'))
    .finally(() => setLoading(false));
  }, [accessToken]);

  async function toggleSuperAdmin(userId: string, current: boolean) {
    try {
      await api(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ isSuperAdmin: !current }) });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isSuperAdmin: !current } : u));
      toast(`Super admin ${current ? 'removed' : 'granted'}`, 'success', toasts, setToasts);
    } catch { toast('Failed to update', 'error', toasts, setToasts); }
  }

  async function changeRole(userId: string, roleId: string | null) {
    try {
      await api(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ customRoleId: roleId || null }) });
      const role = roles.find(r => r.id === roleId);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, customRoleId: roleId, customRole: role ? { id: role.id, name: role.name } : null } : u));
      toast('Role updated', 'success', toasts, setToasts);
    } catch { toast('Failed to update role', 'error', toasts, setToasts); }
  }

  async function resetPassword(userId: string, email: string) {
    if (!confirm(`Reset password for ${email}?`)) return;
    try {
      const res = await api<{ newPassword: string }>(`/users/${userId}/reset-password`, { method: 'POST', body: JSON.stringify({}) });
      toast(`New password: ${res.newPassword}`, 'success', toasts, setToasts);
    } catch { toast('Failed to reset password', 'error', toasts, setToasts); }
  }

  const filteredUsers = users.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) || (u.customRole?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  async function changeOwnPassword() {
    if (newPassword.length < 6) { toast('Password must be at least 6 characters', 'error', toasts, setToasts); return; }
    if (newPassword !== confirmPw) { toast('Passwords do not match', 'error', toasts, setToasts); return; }
    if (!currentUser) return;
    setChangingPw(true);
    try {
      await api(`/users/${currentUser.id}`, { method: 'PATCH', body: JSON.stringify({ password: newPassword }) });
      toast('Password changed successfully', 'success', toasts, setToasts);
      setNewPassword('');
      setConfirmPw('');
    } catch { toast('Failed to change password', 'error', toasts, setToasts); }
    finally { setChangingPw(false); }
  }

  async function launchTest() {
    if (!testEmail.trim()) { toast('Enter an email to send the test to', 'error', toasts, setToasts); return; }
    setLaunching(true);
    setLaunchResult(null);
    try {
      const res = await api<any>('/users/launch', { method: 'POST', body: JSON.stringify({ testEmail: testEmail.trim() }) });
      setLaunchResult(res);
      toast('Test email sent', 'success', toasts, setToasts);
    } catch (e: any) { toast(e?.message ?? 'Failed to send test email', 'error', toasts, setToasts); }
    finally { setLaunching(false); }
  }

  async function launchAll() {
    setLaunching(true);
    setLaunchConfirm(false);
    setLaunchResult({ mode: 'running', total: 0, processed: 0, sent: 0, skipped: 0, failed: 0 });
    try {
      const res = await api<any>('/users/launch', { method: 'POST', body: JSON.stringify({}) });
      const poll = async () => {
        try {
          const job = await api<any>(`/users/launch/${res.jobId}`);
          setLaunchResult({ mode: 'running', ...job });
          if (job.status === 'done') {
            setLaunchResult({ mode: 'launch', ...job });
            toast(`Launched — ${job.sent} emails sent`, 'success', toasts, setToasts);
            setLaunching(false);
          } else if (job.status === 'failed') {
            setLaunchResult({ mode: 'launch', ...job, failed: job.failed, error: job.error });
            toast(job.error ?? 'Launch failed', 'error', toasts, setToasts);
            setLaunching(false);
          } else {
            setTimeout(poll, 1500);
          }
        } catch (e: any) {
          setLaunching(false);
          toast(e?.message ?? 'Failed to fetch launch progress', 'error', toasts, setToasts);
        }
      };
      poll();
    } catch (e: any) {
      setLaunching(false);
      toast(e?.message ?? 'Launch failed', 'error', toasts, setToasts);
    }
  }

  return (
    <>
      <ToastContainer toasts={toasts} />
      <div className="page-title-row">
        <h1 className="page-title">Settings</h1>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 20px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', backgroundColor: tab === t ? 'var(--primary)' : '#fff', color: tab === t ? '#fff' : 'var(--text-color)' }}>
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>{error}</div>
      )}

      {loading ? (
        <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
      ) : tab === 'Admin Users' ? (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <input placeholder="Search by email or role..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, maxWidth: 320, padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none' }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{users.length} admin users</span>
          </div>
          <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>EMAIL</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>ROLE</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>SUPER ADMIN</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No admin users found</td></tr>
                  ) : filteredUsers.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600 }}>
                        {u.email}
                        {u.id === currentUser?.id && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#F15925' }}>(you)</span>}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <select value={u.customRoleId || ''} onChange={e => changeRole(u.id, e.target.value || null)}
                          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: '0.8rem', background: '#fff' }}>
                          <option value="">— No Role —</option>
                          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <ToggleBtn on={u.isSuperAdmin || false} onClick={() => toggleSuperAdmin(u.id, u.isSuperAdmin || false)} />
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <button onClick={() => resetPassword(u.id, u.email)}
                          style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: '0.75rem' }}>
                          Reset Password
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : tab === 'Roles' ? (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 16 }}>{roles.length} custom roles defined</p>
          {roles.length === 0 ? (
            <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No roles created yet</div>
          ) : roles.map(role => {
            const permMap = new Map(role.permissions.map(p => [p.module, p]));
            return (
              <div key={role.id} className="data-card" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{role.name}</strong>
                    {role._count && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{role._count.users} users</span>}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                  {MODULES.map(mod => {
                    const p = permMap.get(mod);
                    return (
                      <div key={mod} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '4px 8px', borderRadius: 8, background: p?.canView ? '#F0FDF4' : '#F9FAFB' }}>
                        <span style={{ flex: 1, fontWeight: p?.canView ? 600 : 400, color: p?.canView ? '#166534' : '#9CA3AF' }}>{mod}</span>
                        {p ? (
                          <span style={{ display: 'flex', gap: 3 }}>
                            {(Object.keys(PERM_LABELS) as (keyof Permission)[]).map(k => (
                              <span key={k} style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', backgroundColor: p[k] ? '#16A34A' : '#E5E7EB' }} title={PERM_LABELS[k]} />
                            ))}
                          </span>
                        ) : (
                          <span style={{ color: '#D1D5DB', fontSize: '0.7rem' }}>—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      ) : tab === 'Security' ? (
        <div className="data-card" style={{ padding: 24, maxWidth: 460 }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Change your password</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20 }}>{currentUser?.email}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>New password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Confirm new password</label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Repeat new password"
                style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none' }} />
            </div>
            <button onClick={changeOwnPassword} disabled={changingPw}
              style={{ alignSelf: 'flex-start', padding: '10px 28px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: changingPw ? 'not-allowed' : 'pointer', opacity: changingPw ? 0.6 : 1 }}>
              {changingPw ? 'Updating...' : 'Change Password'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
          <div className="data-card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: '1rem', marginBottom: 6 }}>Launch Customer Logins</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              Generates a new password for <strong>every</strong> customer and emails them their login username, password, PPPoE/RADIUS username and the customer portal URL.
              <br />Use the test option below first to preview the email.
            </p>

            <div style={{ marginTop: 20, padding: 16, background: '#F8FAFC', borderRadius: 12, border: '1px solid var(--border-color)' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Send test email (no passwords changed)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="you@example.com"
                  style={{ flex: 1, padding: '9px 14px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none' }} />
                <button onClick={launchTest} disabled={launching}
                  style={{ padding: '9px 22px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent', color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: launching ? 'not-allowed' : 'pointer' }}>
                  {launching ? 'Sending...' : 'Send Test'}
                </button>
              </div>
            </div>

            <div style={{ marginTop: 16, padding: 16, background: '#FEF5E7', borderRadius: 12, border: '1px solid #FDE68A' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6, color: '#92400E' }}>Launch for all customers</label>
              {!launchConfirm ? (
                <button onClick={() => setLaunchConfirm(true)}
                  style={{ padding: '10px 28px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                  Launch All
                </button>
              ) : (
                <div style={{ fontSize: '0.85rem', color: '#92400E' }}>
                  <p style={{ margin: '0 0 10px 0' }}><strong>Warning:</strong> this resets every customer's password and emails them. Continue?</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={launchAll} disabled={launching}
                      style={{ padding: '9px 22px', borderRadius: 20, border: 'none', background: '#DC2626', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: launching ? 'not-allowed' : 'pointer' }}>
                      {launching ? 'Launching...' : 'Yes, Launch All'}
                    </button>
                    <button onClick={() => setLaunchConfirm(false)}
                      style={{ padding: '9px 22px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {launchResult && (
              <div style={{ marginTop: 16, padding: 16, background: launchResult.mode === 'running' ? '#EFF6FF' : '#F0FDF4', borderRadius: 12, border: '1px solid ' + (launchResult.mode === 'running' ? '#BFDBFE' : '#BBF7D0'), fontSize: '0.85rem' }}>
                {launchResult.mode === 'test' ? (
                  <div>
                    <strong style={{ color: '#166534' }}>Test email sent to {launchResult.sentTo}</strong>
                    <div style={{ marginTop: 8, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>Sample customer: {launchResult.sample.email} · {launchResult.sample.username} · {launchResult.sample.customerId} · {launchResult.sample.planName}</span>
                      <span style={{ color: '#94A3B8' }}>{launchResult.note}</span>
                    </div>
                  </div>
                ) : launchResult.mode === 'running' ? (
                  <div>
                    <strong style={{ color: '#1D4ED8' }}>Launch in progress — {launchResult.stage}</strong>
                    <div style={{ marginTop: 8, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>Processed: {launchResult.processed} / {launchResult.total}</span>
                      <span style={{ color: '#166534' }}>Emails sent: {launchResult.sent}</span>
                      <span style={{ color: '#92400E' }}>Skipped: {launchResult.skipped} · Failed: {launchResult.failed}</span>
                      <div style={{ marginTop: 6, height: 6, background: '#DBEAFE', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#2563EB', borderRadius: 4, width: launchResult.total ? `${Math.round((launchResult.processed / launchResult.total) * 100)}%` : '0%' }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <strong style={{ color: '#166534' }}>{launchResult.error ? 'Launch failed' : 'Launch complete'}</strong>
                    <div style={{ marginTop: 8, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>Total customers: {launchResult.total}</span>
                      <span style={{ color: '#166534' }}>Emails sent: {launchResult.sent}</span>
                      <span style={{ color: '#92400E' }}>Skipped (no real email): {launchResult.skipped}</span>
                      <span style={{ color: '#DC2626' }}>Failed: {launchResult.failed}</span>
                      {launchResult.error && <span style={{ color: '#DC2626' }}>{launchResult.error}</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}