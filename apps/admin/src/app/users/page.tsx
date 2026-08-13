'use client';

import { useState, useEffect } from 'react';
import { api, useAuthStore } from '@isp/shared';
import { useToast, ToastContainer } from '../../components/Toast';

interface Permission {
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface CustomRoleFull {
  id: string;
  name: string;
  permissions: Permission[];
  _count?: { users: number };
  createdAt: string;
}

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

interface CustomRoleOption {
  id: string;
  name: string;
}

const iconSvgs = [
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v7m0 6v7M2 12h7m6 0h7"/></svg>',
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>',
  '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
];

const iconColors = ['#10B981', '#8B5CF6', '#3B82F6', '#6366F1', '#F59E0B', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#06B6D4', '#A855F7', '#E11D48', '#0EA5E9', '#D946EF'];
const MODULES = ['Dashboard', 'User Control', 'Customer', 'Package', 'Billing', 'Payments', 'Network', 'Support', 'NOC', 'Notifications', 'Audit Logs', 'Owner'];
const PERM_FIELDS: (keyof Permission)[] = ['canView', 'canCreate', 'canEdit', 'canDelete'];

const btnStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: 20, border: '1px solid #e2e8f0', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: '0.75rem' };

function ToggleBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', border: 'none', position: 'relative', backgroundColor: on ? '#F15925' : '#d1d5db', transition: 'background 0.2s' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: '#fff', position: 'absolute', top: 2, left: on ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </button>
  );
}

const STAFF_ROLES = ['SUPER_ADMIN', 'CEO', 'OPERATIONS_MANAGER', 'BILLING_OFFICER', 'SALES_AGENT', 'CUSTOMER_SUPPORT', 'NOC_ENGINEER', 'FIELD_ENGINEER', 'FINANCE_MANAGER'];

export default function UsersPage() {
  const { accessToken } = useAuthStore();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formCustomRoleId, setFormCustomRoleId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCustomRoleId, setEditCustomRoleId] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const [roles, setRoles] = useState<CustomRoleFull[]>([]);
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [editRole, setEditRole] = useState<CustomRoleFull | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState<Permission[]>([]);
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
  const { toast } = useToast();

  const [savingRole, setSavingRole] = useState(false);
  const [showQuickRole, setShowQuickRole] = useState(false);
  const [quickRoleName, setQuickRoleName] = useState('');
  const [quickRolePerms, setQuickRolePerms] = useState<Permission[]>([]);
  const [savingQuickRole, setSavingQuickRole] = useState(false);

  async function fetchUsers() {
    try {
      setError('');
      setLoading(true);
      const data = await api<UserItem[]>('/users');
      setUsers(data);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchRoles() {
    try {
      const data = await api<CustomRoleFull[]>('/custom-roles');
      setRoles(data);
    } catch {}
  }

  useEffect(() => {
    if (accessToken) {
      fetchUsers();
      fetchRoles();
    }
  }, [accessToken]);

  async function handleCreate() {
    setSubmitting(true);
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({ email: formEmail, password: formPassword, customRoleId: formCustomRoleId || undefined }),
      });
      setShowForm(false);
      setFormEmail('');
      setFormPassword('');
      setFormCustomRoleId('');
      await fetchUsers();
    } catch {
      toast('Failed to create user.', 'error', toasts, setToasts);
    } finally {
      setSubmitting(false);
    }
  }

  function openRolesModal(role?: CustomRoleFull) {
    if (role) {
      setEditRole(role);
      setRoleName(role.name);
      setRolePerms(role.permissions.map(p => ({ ...p })));
    } else {
      setEditRole(null);
      setRoleName('');
      setRolePerms(MODULES.map(m => ({ module: m, canView: false, canCreate: false, canEdit: false, canDelete: false })));
    }
    setShowRolesModal(true);
  }

  async function handleSaveRole() {
    setSavingRole(true);
    try {
      const body = { name: roleName, permissions: rolePerms };
      if (editRole) {
        await api(`/custom-roles/${editRole.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/custom-roles', { method: 'POST', body: JSON.stringify(body) });
      }
      setShowRolesModal(false);
      await fetchRoles();
    } catch {
      toast('Failed to save role.', 'error', toasts, setToasts);
    } finally {
      setSavingRole(false);
    }
  }

  function handleDeleteRole(id: string) {
    setConfirmDialog({
      message: 'Delete this role?',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await api(`/custom-roles/${id}`, { method: 'DELETE' });
          await fetchRoles();
        } catch {
          toast('Failed to delete role.', 'error', toasts, setToasts);
        }
        setDeleteRoleId(null);
      },
    });
  }

  function openQuickRoleCreator() {
    setQuickRoleName('');
    setQuickRolePerms(MODULES.map(m => ({ module: m, canView: false, canCreate: false, canEdit: false, canDelete: false })));
    setShowQuickRole(true);
  }

  async function handleCreateQuickRole() {
    setSavingQuickRole(true);
    try {
      const body = { name: quickRoleName, permissions: quickRolePerms };
      const created = await api<{ id: string }>('/custom-roles', { method: 'POST', body: JSON.stringify(body) });
      setShowQuickRole(false);
      await fetchRoles();
      setFormCustomRoleId(created.id);
    } catch {
      toast('Failed to create role.', 'error', toasts, setToasts);
    } finally {
      setSavingQuickRole(false);
    }
  }

  function togglePerm(module: string, field: keyof Permission) {
    setRolePerms(prev => prev.map(p => p.module === module ? { ...p, [field]: !p[field] } : p));
  }

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.floating-popup') && !target.closest('[data-menu-btn]')) {
        setShowMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  if (!accessToken) return null;

  const filtered = users
    .filter((u) => u.isSuperAdmin || (u.customRole && u.customRole.name !== 'CUSTOMER'))
    .filter((u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.phone && u.phone.includes(search))
    );

  return (
    <>
      <div className="page-title-row">
        <h1 className="page-title">User Control</h1>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          Add New <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setShowForm(false)}>
          <div style={{
            background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Create a User</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowForm(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Email</label>
                <input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="user@example.com" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Password</label>
                <input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Min 8 characters" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Custom Permission Role</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={formCustomRoleId} onChange={(e) => setFormCustomRoleId(e.target.value)} style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', background: 'white' }}>
                    <option value="">None</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button onClick={openQuickRoleCreator} title="Create custom role" style={{ width: 40, height: 40, borderRadius: 12, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="18" height="18" fill="none" stroke="#F15925" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={submitting} onClick={handleCreate}>
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setEditUser(null)}>
          <div style={{
            background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Edit User</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setEditUser(null)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Email</label>
                <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="user@example.com" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Phone</label>
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+234 800 000 0000" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Permission Role</label>
                <select value={editCustomRoleId} onChange={(e) => setEditCustomRoleId(e.target.value)} style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', background: 'white' }}>
                  <option value="">None</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>New Password <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(leave blank to keep current)</span></label>
                <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Min 8 characters" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setEditUser(null)}>Cancel</button>
                <button className="btn-primary" disabled={savingEdit} onClick={async () => {
                  setSavingEdit(true);
                  try {
                    const body: Record<string,any> = { email: editEmail, phone: editPhone, customRoleId: editCustomRoleId || null };
                    if (editPassword) body.password = editPassword;
                    await api(`/users/${editUser.id}`, { method: 'PATCH', body: JSON.stringify(body) });
                    setEditUser(null);
                    await fetchUsers();
                    toast('User updated.', 'success', toasts, setToasts);
                  } catch {
                    toast('Failed to update user.', 'error', toasts, setToasts);
                  } finally {
                    setSavingEdit(false);
                  }
                }}>
                  {savingEdit ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="data-card">
        <div className="table-container">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}><input type="checkbox" /></th>
                  <th>NAME</th>
                  <th>EMAIL</th>
                  <th>PHONE</th>
                  <th>ROLE / PERMISSIONS</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, idx) => {
                  const iconIdx = idx % iconSvgs.length;
                  const iconColor = iconColors[idx % iconColors.length];
                  const isSelected = selectedId === u.id;
                  return (
                    <tr key={u.id} style={{ background: isSelected ? '#F8FAFC' : undefined }}>
                      <td><input type="checkbox" checked={isSelected} onChange={() => setSelectedId(isSelected ? null : u.id)} /></td>
                      <td className="company-cell">
                        <span className="company-icon" style={{ color: iconColor }} dangerouslySetInnerHTML={{ __html: iconSvgs[iconIdx] }} />
                        {u.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </td>
                      <td>{u.email}</td>
                      <td>{u.phone ?? '—'}</td>
                      <td>
                        {u.isSuperAdmin ? <span style={{ fontWeight: 600, color: '#F15925' }}>Super Admin</span>
                          : u.customRole?.name ? u.customRole.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                          : <span style={{ color: '#94a3b8' }}>No role</span>}
                      </td>
                      <td>
                        <div style={{ position: 'relative' }}>
                          <span data-menu-btn="true" style={{ cursor: 'pointer' }} onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenuPos({ x: rect.right - 190, y: rect.bottom + 4 });
                            setShowMenu(showMenu === u.id ? null : u.id);
                          }}>
                            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {showMenu && menuPos && (() => {
            const u = users.find(x => x.id === showMenu);
            if (!u) return null;
            return (
              <div className="floating-popup" style={{ position: 'fixed', left: menuPos.x, top: menuPos.y, zIndex: 200 }}>
                <div className="menu-item" onClick={() => { setSelectedId(u.id); setShowMenu(null); }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> View Details
                </div>
                <div className="menu-item" onClick={() => { setEditUser(u); setEditEmail(u.email); setEditPhone(u.phone ?? ''); setEditCustomRoleId(u.customRoleId ?? ''); setEditPassword(''); setShowMenu(null); }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Edit Details
                </div>
                <div className="menu-item" onClick={async () => {
                  setShowMenu(null);
                  try {
                    await api(`/users/${u.id}/reset-password`, { method: 'POST' });
                    toast('Password reset. New password emailed to user.', 'success', toasts, setToasts);
                  } catch {
                    toast('Failed to reset password.', 'error', toasts, setToasts);
                  }
                }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Reset Password
                </div>
                <div className="menu-item" style={{ color: '#DC2626' }} onClick={() => {
                  setConfirmDialog({
                    message: `Delete user ${u.email}?`,
                    onConfirm: async () => {
                      setConfirmDialog(null);
                      try { await api(`/users/${u.id}`, { method: 'DELETE' }); await fetchUsers(); setShowMenu(null); }
                      catch { toast('Failed to delete user.', 'error', toasts, setToasts); }
                    },
                  });
                }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete
                </div>
              </div>
            );
          })()}
        </div>
        {selectedId && (() => {
          const u = users.find(x => x.id === selectedId);
          if (!u) return null;
          return (
            <div className="details-drawer">
              <div className="info-column">
                <div className="info-group">
                  <label>Email</label>
                  <p>{u.email}</p>
                </div>
                <div className="info-group">
                  <label>Phone</label>
                  <p>{u.phone ?? '—'}</p>
                </div>
                <div className="info-group">
                  <label>Permissions</label>
                  <p>{u.isSuperAdmin ? 'Super Admin' : u.customRole?.name ? u.customRole.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'No role'}</p>
                </div>
                <div className="info-group">
                  <label>Created</label>
                  <p>{new Date(u.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div className="info-group">
                  <label>ID</label>
                  <p style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{u.id}</p>
                </div>
              </div>
              <div className="cards-column">
                <div className="section-card">
                  <span className="card-title">Permissions</span>
                  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ color: '#94A3B8' }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{u.isSuperAdmin ? 'Super Admin' : u.customRole?.name ?? 'None'}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {selectedId && (
          <div style={{ padding: '14px 24px', background: '#FAFAFA', borderTop: '1px solid var(--border-color)' }}>
            <a href="#" className="card-footer-link" onClick={(e) => { e.preventDefault(); setSelectedId(null); }}>
              Close Details <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </a>
          </div>
        )}
      </div>

      <div className="data-card" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Roles & Permissions</h2>
          <button className="btn-primary" onClick={() => openRolesModal()}>Add Role</button>
        </div>
        <div className="table-container">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ROLE NAME</th>
                  <th>USERS</th>
                  <th>CREATED</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {roles.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r._count?.users ?? 0}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new Date(r.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={btnStyle} onClick={() => openRolesModal(r)}>
                          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button style={btnStyle} onClick={() => handleDeleteRole(r.id)}>
                          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showQuickRole && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 110,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setShowQuickRole(false)}>
          <div style={{
            background: 'white', padding: 28, width: 560, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Create Custom Role</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowQuickRole(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Role Name</label>
              <input value={quickRoleName} onChange={(e) => setQuickRoleName(e.target.value)} placeholder="e.g. Support Manager" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
            </div>

            <div style={{ border: '1px solid var(--border-color)', borderRadius: 16, overflow: 'hidden' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '40%', color: '#0F172A' }}>Module</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>View</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>Create</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>Edit</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {quickRolePerms.map(p => (
                    <tr key={p.module}>
                      <td style={{ padding: '8px 14px', fontWeight: 500, borderBottom: '1px solid #f1f5f9' }}>{p.module}</td>
                      {PERM_FIELDS.map(f => (
                        <td key={f} style={{ padding: '8px 4px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>
                          <ToggleBtn on={!!p[f]} onClick={() => setQuickRolePerms(prev => prev.map(x => x.module === p.module ? { ...x, [f]: !x[f] } : x))} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn-outline" onClick={() => setShowQuickRole(false)}>Cancel</button>
              <button className="btn-primary" disabled={savingQuickRole || !quickRoleName.trim()} onClick={handleCreateQuickRole}>
                {savingQuickRole ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRolesModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setShowRolesModal(false)}>
          <div style={{
            background: 'white', padding: 32, width: 640, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{editRole ? 'Edit' : 'Add'} Role</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowRolesModal(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Role Name</label>
              <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Support Manager" style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
            </div>

            <div style={{ border: '1px solid var(--border-color)', borderRadius: 16, overflow: 'hidden' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '40%', color: '#0F172A' }}>Module</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>View</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>Create</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>Edit</th>
                    <th style={{ padding: '10px 4px', textAlign: 'center', fontWeight: 700, borderBottom: '1px solid var(--border-color)', width: '15%', color: '#0F172A' }}>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {rolePerms.map(p => (
                    <tr key={p.module}>
                      <td style={{ padding: '8px 14px', fontWeight: 500, borderBottom: '1px solid #f1f5f9' }}>{p.module}</td>
                      {PERM_FIELDS.map(f => (
                        <td key={f} style={{ padding: '8px 4px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>
                          <ToggleBtn on={!!p[f]} onClick={() => togglePerm(p.module, f)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn-outline" onClick={() => setShowRolesModal(false)}>Cancel</button>
              <button className="btn-primary" disabled={savingRole || !roleName.trim()} onClick={handleSaveRole}>
                {savingRole ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setConfirmDialog(null)}>
          <div style={{
            background: 'white', borderRadius: 20, padding: 28, width: 380, maxWidth: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Confirm</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 24 }}>{confirmDialog.message}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn-outline" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button className="btn-primary" style={{ backgroundColor: '#DC2626' }} onClick={confirmDialog.onConfirm}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </>
  );
}

