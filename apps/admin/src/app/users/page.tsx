'use client';

import { useState, useEffect } from 'react';
import { api, useAuthStore } from '@isp/shared';
import { LayoutGrid, List, Eye, Shield, Layers } from 'lucide-react';
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

const iconSvgs: React.ReactNode[] = [
  <svg key="0" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  <svg key="1" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  <svg key="2" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  <svg key="3" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  <svg key="4" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  <svg key="5" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v7m0 6v7M2 12h7m6 0h7"/></svg>,
  <svg key="6" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>,
  <svg key="7" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
];

const iconColors = ['#10B981', '#8B5CF6', '#3B82F6', '#6366F1', '#F59E0B', '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#06B6D4', '#A855F7', '#E11D48', '#0EA5E9', '#D946EF'];
const MODULES = ['Dashboard', 'User Control', 'Customer', 'Package', 'Billing', 'Payments', 'Network', 'Support', 'NOC', 'Notifications', 'Audit Logs', 'Owner'];
const PERM_FIELDS: (keyof Permission)[] = ['canView', 'canCreate', 'canEdit', 'canDelete'];

// role visual mapping
const roleAccent: Record<string, { bg: string; fg: string; soft: string }> = {
  CUSTOMER: { bg: '#EFF6FF', fg: '#2563EB', soft: '#DBEAFE' },
  FINANCE_MANAGER: { bg: '#FEF3C7', fg: '#B45309', soft: '#FDE68A' },
  FIELD_ENGINEER: { bg: '#DCFCE7', fg: '#166534', soft: '#BBF7D0' },
  SALES_AGENT: { bg: '#FDF2F8', fg: '#BE185D', soft: '#FBCFE8' },
  BILLING_OFFICER: { bg: '#F0FDF4', fg: '#15803D', soft: '#BBF7D0' },
  SUPER_ADMIN: { bg: '#FFF7ED', fg: '#C2410C', soft: '#FFEDD5' },
};

function getRoleStyle(name: string) {
  return roleAccent[name] ?? { bg: '#F8FAFC', fg: '#475569', soft: '#E2E8F0' };
}

function ToggleBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 38, height: 22, borderRadius: 11, cursor: 'pointer', border: 'none', position: 'relative', backgroundColor: on ? '#F15925' : '#E2E8F0', transition: 'background 0.22s', boxShadow: on ? '0 2px 8px rgba(241,89,37,0.3)' : 'none' }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: '#fff', position: 'absolute', top: 2, left: on ? 18 : 2, transition: 'left 0.22s cubic-bezier(.4,0,.2,1)', boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }} />
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
  const [rolesView, setRolesView] = useState<'extended' | 'classic'>('extended');

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
      message: 'Delete this role? This cannot be undone.',
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

  const totalRoles = roles.length;
  const activeRoles = roles.filter(r => (r._count?.users ?? 0) > 0).length;

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg, #F15925 0%, #FF8A50 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 6px 16px rgba(241,89,37,0.25)' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            User Control
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 4, fontWeight: 500 }}>Manage staff access, invitations and granular permissions</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)} style={{ padding: '10px 18px', fontSize: '0.82rem', boxShadow: '0 6px 16px rgba(241,89,37,0.25)' }}>
          Add New <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[
          { label: 'Total staff', value: filtered.length, hint: `${users.length} accounts`, icon: <svg width="16" height="16" fill="none" stroke="#2563EB" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, bg: '#EFF6FF', fg: '#2563EB' },
          { label: 'Roles', value: totalRoles, hint: `${activeRoles} active`, icon: <svg width="16" height="16" fill="none" stroke="#7C3AED" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>, bg: '#F5F3FF', fg: '#7C3AED' },
          { label: 'With access', value: filtered.filter(u => u.customRole || u.isSuperAdmin).length, hint: 'assigned role', icon: <svg width="16" height="16" fill="none" stroke="#16A34A" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>, bg: '#F0FDF4', fg: '#16A34A' },
        ].map(s => (
          <div key={s.label} className="data-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, borderTop: `3px solid ${s.fg}` }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: s.bg, color: s.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{s.label}</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600 }}>{s.hint}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="search-box" style={{ flex: '1 1 320px', maxWidth: 420, background: '#fff', border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <svg width="16" height="16" fill="none" stroke="#94A3B8" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or phone..." style={{ fontWeight: 500 }} />
          {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: '#F1F5F9', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}><svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: '#475569', fontWeight: 600, background: '#fff', border: '1px solid #E2E8F0', padding: '8px 14px', borderRadius: 99 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: filtered.length ? '#16A34A' : '#94A3B8' }} />{filtered.length} user{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setShowForm(false)}>
          <div style={{
            background: '#fff', padding: 0, width: 480, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '22px 24px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: -0.2 }}>Create a User</h2>
                <button onClick={() => setShowForm(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748B', fontWeight: 500, marginBottom: 18 }}>Invite a teammate and assign a permission role.</p>
            </div>
            <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Email</label>
                <input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="user@example.com" style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Password</label>
                <input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Min 8 characters" style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Custom Permission Role</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={formCustomRoleId} onChange={(e) => setFormCustomRoleId(e.target.value)} style={{ flex: 1, padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC', fontWeight: 500 }}>
                    <option value="">None — no extra access</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button onClick={openQuickRoleCreator} title="Create custom role" style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid #FFE4D6', background: '#FFF7ED', color: '#F15925', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 18 }}>
                <button className="btn-outline" onClick={() => setShowForm(false)} style={{ padding: '10px 18px' }}>Cancel</button>
                <button className="btn-primary" disabled={submitting} onClick={handleCreate} style={{ padding: '10px 22px', boxShadow: '0 6px 16px rgba(241,89,37,0.25)' }}>
                  {submitting ? 'Creating...' : 'Create user'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setEditUser(null)}>
          <div style={{
            background: '#fff', padding: 0, width: 480, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '22px 24px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: -0.2 }}>Edit User</h2>
                <button onClick={() => setEditUser(null)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748B', fontWeight: 500, marginBottom: 18 }}>{editUser.email}</p>
            </div>
            <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Email</label>
                <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="user@example.com" style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Phone</label>
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+234 800 000 0000" style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Permission Role</label>
                <select value={editCustomRoleId} onChange={(e) => setEditCustomRoleId(e.target.value)} style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC', fontWeight: 500 }}>
                  <option value="">None</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>New Password <span style={{ fontWeight: 500, color: '#94A3B8', textTransform: 'none', letterSpacing: 0 }}>— leave blank to keep</span></label>
                <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Min 8 characters" style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 18 }}>
                <button className="btn-outline" onClick={() => setEditUser(null)} style={{ padding: '10px 18px' }}>Cancel</button>
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
                }} style={{ padding: '10px 22px', boxShadow: '0 6px 16px rgba(241,89,37,0.25)' }}>
                  {savingEdit ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="data-card users-table-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F1F5F9', background: 'linear-gradient(180deg, #fff 0%, #FCFDFF 100%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 9, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0F172A' }}>Staff Members</div>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, background: '#F1F5F9', color: '#475569', padding: '3px 10px', borderRadius: 99 }}>{filtered.length}</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />Live</div>
        </div>
        <div className="table-container">
          <div className="table-scroll" style={{ overflowY: 'auto', maxHeight: 460 }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                <tr>
                  <th style={{ width: 40, background: '#F8FAFC' }}><input type="checkbox" style={{ accentColor: '#F15925' }} /></th>
                  <th style={{ background: '#F8FAFC' }}>NAME</th>
                  <th style={{ background: '#F8FAFC' }}>EMAIL</th>
                  <th style={{ background: '#F8FAFC' }}>PHONE</th>
                  <th style={{ background: '#F8FAFC' }}>ROLE / PERMISSIONS</th>
                  <th style={{ width: 40, background: '#F8FAFC' }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94A3B8' }}>Loading staff…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 0 }}>
                    <div style={{ padding: '36px 24px', textAlign: 'center' }}>
                      <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F8FAFC', border: '1px dashed #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', color: '#94A3B8' }}><svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></div>
                      <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.9rem' }}>No staff yet</div>
                      <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: 4 }}>{search ? `No match for “${search}”` : 'Create your first teammate to get started'}</div>
                      {!search && <button className="btn-primary" onClick={() => setShowForm(true)} style={{ margin: '14px auto 0', padding: '8px 16px', fontSize: '0.78rem' }}>Add New User</button>}
                    </div>
                  </td></tr>
                ) : filtered.map((u, idx) => {
                  const iconIdx = idx % iconSvgs.length;
                  const iconColor = iconColors[idx % iconColors.length];
                  const isSelected = selectedId === u.id;
                  const displayName = u.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                  const roleName = u.isSuperAdmin ? 'Super Admin' : u.customRole?.name ? u.customRole.name.replace(/_/g, ' ') : 'No role';
                  const roleStyle = getRoleStyle(u.customRole?.name ?? (u.isSuperAdmin ? 'SUPER_ADMIN' : ''));
                  return (
                    <tr key={u.id} style={{ background: isSelected ? '#FFFBF8' : undefined, transition: 'background 0.15s' }}>
                      <td><input type="checkbox" checked={isSelected} onChange={() => setSelectedId(isSelected ? null : u.id)} style={{ accentColor: '#F15925' }} /></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="company-icon" style={{ width: 32, height: 32, borderRadius: 10, background: `${iconColor}14`, color: iconColor, border: `1px solid ${iconColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{iconSvgs[iconIdx]}</span>
                          <span style={{ fontWeight: 700, color: '#0F172A', fontSize: '0.85rem' }}>{displayName}</span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 500, color: '#334155' }}>{u.email}</td>
                      <td style={{ color: u.phone ? '#334155' : '#CBD5E1', fontWeight: 500 }}>{u.phone ?? '—'}</td>
                      <td>
                        {u.isSuperAdmin ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#C2410C', background: '#FFF7ED', border: '1px solid #FFEDD5', padding: '4px 10px', borderRadius: 99, fontSize: '0.72rem' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />Super Admin</span>
                          : u.customRole?.name ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: roleStyle.fg, background: roleStyle.bg, border: `1px solid ${roleStyle.soft}`, padding: '4px 10px', borderRadius: 99, fontSize: '0.72rem' }}>{roleName}</span>
                          : <span style={{ color: '#94A3B8', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '4px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 600 }}>No role</span>}
                      </td>
                      <td>
                        <div style={{ position: 'relative' }}>
                          <button data-menu-btn="true" onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenuPos({ x: rect.right - 190, y: rect.bottom + 8 });
                            setShowMenu(showMenu === u.id ? null : u.id);
                          }} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #E2E8F0', background: showMenu === u.id ? '#F8FAFC' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}>
                            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                          </button>
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
              <div className="floating-popup" style={{ position: 'fixed', left: menuPos.x, top: menuPos.y, zIndex: 200, borderRadius: 16, padding: 6, boxShadow: '0 12px 32px rgba(15,23,42,0.12)', border: '1px solid #E2E8F0' }}>
                <div className="menu-item" onClick={() => { setSelectedId(u.id); setShowMenu(null); }} style={{ borderRadius: 10 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> View Details
                </div>
                <div className="menu-item" onClick={() => { setEditUser(u); setEditEmail(u.email); setEditPhone(u.phone ?? ''); setEditCustomRoleId(u.customRoleId ?? ''); setEditPassword(''); setShowMenu(null); }} style={{ borderRadius: 10 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Details
                </div>
                <div className="menu-item" onClick={async () => {
                  setShowMenu(null);
                  try {
                    await api(`/users/${u.id}/reset-password`, { method: 'POST' });
                    toast('Password reset. New password emailed to user.', 'success', toasts, setToasts);
                  } catch {
                    toast('Failed to reset password.', 'error', toasts, setToasts);
                  }
                }} style={{ borderRadius: 10 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Reset Password
                </div>
                <div className="menu-item" style={{ color: '#DC2626', borderRadius: 10 }} onClick={() => {
                  setConfirmDialog({
                    message: `Delete user ${u.email}? This will soft-delete the account.`,
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
          const roleStr = u.isSuperAdmin ? 'Super Admin' : u.customRole?.name ? u.customRole.name.replace(/_/g, ' ') : 'No role';
          return (
            <div className="details-drawer" style={{ background: '#FFFBF8', borderTop: '1px solid #FFE4D6', padding: '18px 20px' }}>
              <div className="info-column" style={{ gap: '14px 24px' }}>
                <div className="info-group">
                  <label style={{ color: '#94A3B8', letterSpacing: 0.5 }}>Email</label>
                  <p style={{ fontWeight: 700 }}>{u.email}</p>
                </div>
                <div className="info-group">
                  <label style={{ color: '#94A3B8', letterSpacing: 0.5 }}>Phone</label>
                  <p>{u.phone ?? '—'}</p>
                </div>
                <div className="info-group">
                  <label style={{ color: '#94A3B8', letterSpacing: 0.5 }}>Permissions</label>
                  <p style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: u.isSuperAdmin ? '#C2410C' : '#334155' }}>{roleStr}</p>
                </div>
                <div className="info-group">
                  <label style={{ color: '#94A3B8', letterSpacing: 0.5 }}>Created</label>
                  <p>{new Date(u.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div className="info-group" style={{ gridColumn: '1 / -1' }}>
                  <label style={{ color: '#94A3B8', letterSpacing: 0.5 }}>ID</label>
                  <p style={{ fontSize: '0.72rem', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', color: '#64748B', background: '#fff', border: '1px solid #FFE4D6', padding: '6px 10px', borderRadius: 10 }}>{u.id}</p>
                </div>
              </div>
              <div className="cards-column">
                <div className="section-card" style={{ border: '1px solid #FFE4D6', background: '#fff', borderRadius: 16 }}>
                  <span className="card-title" style={{ fontWeight: 700, color: '#94A3B8', fontSize: '0.68rem', letterSpacing: 0.5 }}>PERMISSIONS</span>
                  <svg width="24" height="24" fill="none" stroke="#F59E0B" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0F172A' }}>{u.isSuperAdmin ? 'Super Admin' : u.customRole?.name ?? 'None'}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {selectedId && (
          <div style={{ padding: '12px 20px', background: '#FFFBF8', borderTop: '1px solid #FFE4D6', display: 'flex', justifyContent: 'flex-start' }}>
            <button onClick={() => setSelectedId(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#F15925', fontWeight: 700, fontSize: '0.78rem', background: '#fff', border: '1px solid #FFE4D6', padding: '6px 14px', borderRadius: 99, cursor: 'pointer' }}>
              Close Details <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}
      </div>

      <div className="users-mobile-list">
        {filtered.length === 0 ? (
          <div className="data-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No users found</div>
        ) : filtered.map((u) => {
          const name = u.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const role = u.isSuperAdmin ? 'Super Admin' : u.customRole?.name ? u.customRole.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'No role';
          const isOpen = selectedId === u.id;
          const accent = getRoleStyle(u.customRole?.name ?? (u.isSuperAdmin ? 'SUPER_ADMIN' : ''));
          return (
            <div key={u.id} className="data-card" style={{ padding: 16, borderTop: `3px solid ${accent.fg}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ minWidth: 0, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: accent.bg, color: accent.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>{name.slice(0,2).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0F172A' }}>{name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748B', wordBreak: 'break-all' }}>{u.email}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: 2 }}>{u.phone ?? 'No phone'}</div>
                  </div>
                </div>
                <button className="btn-sm-outline" onClick={() => setSelectedId(isOpen ? null : u.id)} style={{ borderRadius: 99 }}>{isOpen ? 'Hide' : 'View'}</button>
              </div>
              <div style={{ marginTop: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, background: accent.bg, color: accent.fg, border: `1px solid ${accent.soft}` }}>{role}</span>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button className="btn-sm-outline" onClick={() => { setEditUser(u); setEditEmail(u.email); setEditPhone(u.phone ?? ''); setEditCustomRoleId(u.customRoleId ?? ''); setEditPassword(''); }} style={{ flex: 1 }}>Edit</button>
                <button className="btn-sm-outline" onClick={async () => {
                  try {
                    await api(`/users/${u.id}/reset-password`, { method: 'POST' });
                    toast('Password reset. New password emailed to user.', 'success', toasts, setToasts);
                  } catch {
                    toast('Failed to reset password.', 'error', toasts, setToasts);
                  }
                }} style={{ flex: 1 }}>Reset</button>
                <button className="btn-sm-outline" style={{ color: '#DC2626', borderColor: '#FECACA', background: '#FEF2F2', flex: 1 }} onClick={() => {
                  setConfirmDialog({
                    message: `Delete user ${u.email}?`,
                    onConfirm: async () => {
                      setConfirmDialog(null);
                      try { await api(`/users/${u.id}`, { method: 'DELETE' }); await fetchUsers(); }
                      catch { toast('Failed to delete user.', 'error', toasts, setToasts); }
                    },
                  });
                }}>Delete</button>
              </div>

              {isOpen && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #F1F5F9', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="info-group">
                    <label>Phone</label>
                    <p>{u.phone ?? '—'}</p>
                  </div>
                  <div className="info-group">
                    <label>Permissions</label>
                    <p>{role}</p>
                  </div>
                  <div className="info-group">
                    <label>Created</label>
                    <p>{new Date(u.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>
                  <div className="info-group" style={{ gridColumn: '1 / -1' }}>
                    <label>ID</label>
                    <p style={{ fontSize: '0.68rem', wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', color: '#64748B' }}>{u.id}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="data-card" style={{ marginTop: 20, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #F1F5F9', background: 'linear-gradient(180deg, #FFFBF8 0%, #fff 100%)', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: '#F5F3FF', color: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={16} strokeWidth={2} /></div>
            <div>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>Roles & Permissions</h2>
              <p style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600 }}>{totalRoles} roles · {activeRoles} with members</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', padding: 3, background: '#F1F5F9', borderRadius: 20, border: '1px solid #E2E8F0' }}>
              <button onClick={() => setRolesView('extended')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 16, border: 'none', background: rolesView === 'extended' ? '#fff' : 'transparent', color: rolesView === 'extended' ? '#7C3AED' : '#64748B', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', boxShadow: rolesView === 'extended' ? '0 1px 6px rgba(15,23,42,0.08)' : 'none', transition: 'all 0.15s' }}>
                <LayoutGrid size={13} strokeWidth={2} /> Extended
              </button>
              <button onClick={() => setRolesView('classic')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 16, border: 'none', background: rolesView === 'classic' ? '#fff' : 'transparent', color: rolesView === 'classic' ? '#7C3AED' : '#64748B', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', boxShadow: rolesView === 'classic' ? '0 1px 6px rgba(15,23,42,0.08)' : 'none', transition: 'all 0.15s' }}>
                <List size={13} strokeWidth={2} /> Classic
              </button>
            </div>
            <button className="btn-primary" onClick={() => openRolesModal()} style={{ padding: '9px 16px', fontSize: '0.8rem', boxShadow: '0 6px 16px rgba(241,89,37,0.22)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Add Role <Layers size={14} strokeWidth={2} /></button>
          </div>
        </div>

        {roles.length === 0 ? (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F8FAFC', border: '1px dashed #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', color: '#94A3B8' }}><Shield size={20} strokeWidth={1.6} /></div>
            <div style={{ fontWeight: 700, color: '#334155' }}>No custom roles yet</div>
            <div style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: 4 }}>Create a role to bundle permissions for staff</div>
            <button className="btn-primary" onClick={() => openRolesModal()} style={{ margin: '14px auto 0', padding: '8px 16px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Layers size={14} strokeWidth={2} /> Add Role</button>
          </div>
        ) : rolesView === 'extended' ? (
          <div style={{ padding: 16, background: '#F8FAFC' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {roles.map(r => {
                const st = getRoleStyle(r.name);
                const permsEnabled = r.permissions.filter(p => p.canView || p.canCreate || p.canEdit || p.canDelete).length;
                return (
                  <div key={r.id} style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.03)', transition: 'transform 0.15s, boxShadow 0.15s' }} onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.06)'; }} onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 10px rgba(0,0,0,0.03)'; }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 12, background: st.bg, color: st.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${st.soft}` }}>
                          <Shield size={16} strokeWidth={2} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0F172A', lineHeight: 1.1, wordBreak: 'break-word' }}>{r.name.replace(/_/g, ' ')}</div>
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600, marginTop: 2 }}>{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: (r._count?.users ?? 0) ? '#F0FDF4' : '#F8FAFC', color: (r._count?.users ?? 0) ? '#16A34A' : '#94A3B8', border: `1px solid ${(r._count?.users ?? 0) ? '#BBF7D0' : '#E2E8F0'}`, padding: '4px 10px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: (r._count?.users ?? 0) ? '#16A34A' : '#94A3B8' }} />{r._count?.users ?? 0} user{(r._count?.users ?? 0) === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 99, background: '#F1F5F9', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round((permsEnabled / MODULES.length) * 100)}%`, height: '100%', background: st.fg, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B' }}>{permsEnabled}/{MODULES.length} modules</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {r.permissions.filter(p => p.canView).slice(0, 4).map(p => (
                        <span key={p.module} style={{ fontSize: '0.64rem', fontWeight: 600, background: '#F8FAFC', border: '1px solid #F1F5F9', color: '#475569', padding: '3px 8px', borderRadius: 99 }}>{p.module}</span>
                      ))}
                      {r.permissions.filter(p => p.canView).length > 4 && <span style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8' }}>+{r.permissions.filter(p => p.canView).length - 4} more</span>}
                      {permsEnabled === 0 && <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontStyle: 'italic' }}>No permissions yet</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
                      <button onClick={() => openRolesModal(r)} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', fontWeight: 700, fontSize: '0.75rem', color: '#334155', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Eye size={12} strokeWidth={2} /> Edit
                      </button>
                      <button onClick={() => handleDeleteRole(r.id)} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid #FECACA', background: '#FEF2F2', fontWeight: 700, fontSize: '0.75rem', color: '#DC2626', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Layers size={12} strokeWidth={2} /> Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ padding: 16, background: '#fff' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {roles.map(role => {
                const permMap = new Map(role.permissions.map(p => [p.module, p]));
                const st = getRoleStyle(role.name);
                return (
                  <div key={role.id} className="data-card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #F1F5F9', boxShadow: 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: st.bg, borderBottom: `1px solid ${st.soft}`, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#fff', color: st.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${st.soft}`, flexShrink: 0 }}><Shield size={14} strokeWidth={2} /></div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0F172A' }}>{role.name.replace(/_/g, ' ')}</div>
                          <div style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 600 }}>{role._count?.users ?? 0} user{(role._count?.users ?? 0) === 1 ? '' : 's'} • {new Date(role.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openRolesModal(role)} style={{ padding: '6px 12px', borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff', fontWeight: 700, fontSize: '0.72rem', color: '#334155', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Eye size={12} strokeWidth={2} /> Edit</button>
                        <button onClick={() => handleDeleteRole(role.id)} style={{ padding: '6px 12px', borderRadius: 9, border: '1px solid #FECACA', background: '#FEF2F2', fontWeight: 700, fontSize: '0.72rem', color: '#DC2626', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Layers size={12} strokeWidth={2} /> Delete</button>
                      </div>
                    </div>
                    <div style={{ padding: 12, background: '#fff' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                        {['Dashboard','User Control','Customer','Package','Billing','Payments','Network','Support','NOC','Notifications','Audit Logs','Owner'].map(mod => {
                          const p = permMap.get(mod);
                          const hasAny = !!(p && (p.canView || p.canCreate || p.canEdit || p.canDelete));
                          return (
                            <div key={mod} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', padding: '6px 8px', borderRadius: 8, background: hasAny ? '#F0FDF4' : '#F9FAFB', border: `1px solid ${hasAny ? '#DCFCE7' : '#F1F5F9'}` }}>
                              <span style={{ flex: 1, fontWeight: hasAny ? 700 : 500, color: hasAny ? '#14532D' : '#9CA3AF', fontSize: '0.72rem' }}>{mod}</span>
                              {p ? (
                                <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                  {(['canView','canCreate','canEdit','canDelete'] as const).map(k => (
                                    <span key={k} title={k.replace('can','')} style={{ width: 7, height: 7, borderRadius: '50%', display: 'inline-block', backgroundColor: (p as any)[k] ? '#16A34A' : '#E5E7EB', border: (p as any)[k] ? '1px solid #16A34A' : '1px solid #E5E7EB' }} />
                                  ))}
                                </span>
                              ) : (
                                <span style={{ color: '#D1D5DB', fontSize: '0.68rem' }}>—</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} /> View</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} /> Create</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} /> Edit</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} /> Delete</span>
                        <span style={{ color: '#CBD5E1' }}>•</span> Classic detailed permissions
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showQuickRole && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', zIndex: 110,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setShowQuickRole(false)}>
          <div style={{
            background: '#fff', padding: 0, width: 560, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Create Custom Role</h2>
                <button onClick={() => setShowQuickRole(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748B', fontWeight: 500, marginBottom: 14 }}>Name the role and toggle what each module can do.</p>
            </div>
            <div style={{ padding: '0 24px' }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Role Name</label>
              <input value={quickRoleName} onChange={(e) => setQuickRoleName(e.target.value)} placeholder="e.g. Support Manager" style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC' }} />
            </div>

            <div style={{ margin: '16px 24px 0', border: '1px solid #E2E8F0', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 0.7fr)', gap: 0, background: '#F8FAFC', padding: '10px 14px', borderBottom: '1px solid #E2E8F0', fontSize: '0.68rem', fontWeight: 800, color: '#475569', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                <span>Module</span><span style={{ textAlign: 'center' }}>View</span><span style={{ textAlign: 'center' }}>Create</span><span style={{ textAlign: 'center' }}>Edit</span><span style={{ textAlign: 'center' }}>Delete</span>
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {quickRolePerms.map(p => (
                  <div key={p.module} style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 0.7fr)', gap: 0, padding: '10px 14px', borderBottom: '1px solid #F8FAFC', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#0F172A' }}>{p.module}</span>
                    {PERM_FIELDS.map(f => (
                      <span key={f} style={{ display: 'flex', justifyContent: 'center' }}>
                        <ToggleBtn on={!!p[f]} onClick={() => setQuickRolePerms(prev => prev.map(x => x.module === p.module ? { ...x, [f]: !x[f] } : x))} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 'auto', padding: '16px 24px 24px' }}>
              <button className="btn-outline" onClick={() => setShowQuickRole(false)} style={{ padding: '10px 18px' }}>Cancel</button>
              <button className="btn-primary" disabled={savingQuickRole || !quickRoleName.trim()} onClick={handleCreateQuickRole} style={{ padding: '10px 22px', boxShadow: '0 6px 16px rgba(241,89,37,0.25)' }}>
                {savingQuickRole ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRolesModal && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', zIndex: 100,
          display: 'flex', justifyContent: 'flex-end'
        }} onClick={() => setShowRolesModal(false)}>
          <div style={{
            background: '#fff', padding: 0, width: 640, maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800 }}>{editRole ? 'Edit' : 'Add'} Role</h2>
                <button onClick={() => setShowRolesModal(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#64748B', fontWeight: 500, marginBottom: 14 }}>{editRole ? 'Update permissions for this role.' : 'Create a new permission bundle for staff.'}</p>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.72rem', color: '#475569', letterSpacing: 0.4, textTransform: 'uppercase' }}>Role Name</label>
              <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="e.g. Support Manager" style={{ width: '100%', padding: '11px 14px', border: '1px solid #E2E8F0', borderRadius: 12, fontSize: '0.88rem', outline: 'none', background: '#F8FAFC', marginBottom: 14 }} />
            </div>

            <div style={{ margin: '0 24px', border: '1px solid #E2E8F0', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 0.7fr)', gap: 0, background: '#F8FAFC', padding: '10px 14px', borderBottom: '1px solid #E2E8F0', fontSize: '0.68rem', fontWeight: 800, color: '#475569', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                <span>Module</span><span style={{ textAlign: 'center' }}>View</span><span style={{ textAlign: 'center' }}>Create</span><span style={{ textAlign: 'center' }}>Edit</span><span style={{ textAlign: 'center' }}>Delete</span>
              </div>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {rolePerms.map(p => (
                  <div key={p.module} style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 0.7fr)', gap: 0, padding: '10px 14px', borderBottom: '1px solid #F8FAFC', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#0F172A' }}>{p.module}</span>
                    {PERM_FIELDS.map(f => (
                      <span key={f} style={{ display: 'flex', justifyContent: 'center' }}>
                        <ToggleBtn on={!!p[f]} onClick={() => togglePerm(p.module, f)} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 'auto', padding: '16px 24px 24px' }}>
              <button className="btn-outline" onClick={() => setShowRolesModal(false)} style={{ padding: '10px 18px' }}>Cancel</button>
              <button className="btn-primary" disabled={savingRole || !roleName.trim()} onClick={handleSaveRole} style={{ padding: '10px 22px', boxShadow: '0 6px 16px rgba(241,89,37,0.25)' }}>
                {savingRole ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog && (
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)', zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setConfirmDialog(null)}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 24, width: 380, maxWidth: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)', border: '1px solid #F1F5F9'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#FEF2F2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}><svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: 8, color: '#0F172A' }}>Confirm action</h3>
            <p style={{ fontSize: '0.88rem', color: '#64748B', fontWeight: 500, marginBottom: 20, lineHeight: 1.5 }}>{confirmDialog.message}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-outline" onClick={() => setConfirmDialog(null)} style={{ padding: '9px 16px' }}>Cancel</button>
              <button className="btn-primary" style={{ backgroundColor: '#DC2626', padding: '9px 16px', boxShadow: '0 6px 16px rgba(220,38,38,0.25)' }} onClick={confirmDialog.onConfirm}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </>
  );
}
