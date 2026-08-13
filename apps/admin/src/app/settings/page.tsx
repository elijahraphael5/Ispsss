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

const TABS = ['Admin Users', 'Roles', 'Security'];

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
      ) : (
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
      )}
    </>
  );
}