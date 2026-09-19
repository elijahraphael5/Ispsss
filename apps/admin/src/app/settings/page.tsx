'use client';

import { useState, useEffect, useRef } from 'react';
import { api, apiUpload, useAuthStore } from '@isp/shared';
import {
  Users,
  Shield,
  Lock,
  Rocket,
  Building2,
  Plug2,
  Wrench,
  FileText,
  CreditCard,
  Mail,
  Settings2,
} from 'lucide-react';
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

const TABS = ['Admin Users', 'Roles', 'Security', 'Launch', 'Company', 'Integrations', 'Backup'];

const fieldLabel: React.CSSProperties = { display: 'block', marginBottom: 5, fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 };
const fieldInput: React.CSSProperties = { width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const pendingNote: React.CSSProperties = { marginTop: 16, fontSize: '0.78rem', color: '#B45309', background: '#FEF3C7', padding: '10px 14px', borderRadius: 10, lineHeight: 1.55 };
const pendingTag: React.CSSProperties = { marginLeft: 6, fontSize: '0.62rem', fontWeight: 700, color: '#B45309', background: '#FEF3C7', padding: '1px 7px', borderRadius: 8, textTransform: 'none', letterSpacing: 0 };

interface TenantSettings {
  name: string;
  slug: string;
  isActive: boolean;
  profile: { logoUrl: string | null; email: string | null; phone: string | null; address: string | null };
  billing: { vatRate: number; invoicePrefix: string };
  installation: { fiberFeeKobo: number; radioFeeKobo: number };
  paymentProvider: string;
  paystack: { enabled: boolean; publicKey: string | null; secretMasked: string | null; hasSecret: boolean };
  flutterwave: { enabled: boolean; publicKey: string | null; secretMasked: string | null; hasSecret: boolean; webhookSecretMasked: string | null; hasWebhookSecret: boolean };
  email: { enabled: boolean; host: string | null; port: number | null; user: string | null; passMasked: string | null; hasPass: boolean; fromEmail: string | null; fromName: string | null };
  persistedFields: string[];
  pendingFields: string[];
}

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
  const [integrationTab, setIntegrationTab] = useState<'Installation' | 'Billing Defaults' | 'Payment Gateway' | 'Email'>('Installation');
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
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState<{ name: string; permissions: Permission[] }>({ name: '', permissions: [] });
  const [roleSaving, setRoleSaving] = useState(false);
  const [tenant, setTenant] = useState<TenantSettings | null>(null);
  const [companyForm, setCompanyForm] = useState({ name: '', logoUrl: '', email: '', phone: '', address: '' });
  const [billingForm, setBillingForm] = useState({ vatRate: '7.5', invoicePrefix: 'INV' });
  const [installationForm, setInstallationForm] = useState({ fiberFee: '50000', radioFee: '120000' });
  const [paystackForm, setPaystackForm] = useState({ enabled: false, publicKey: '', secretKey: '' });
  const [paystackSecretMasked, setPaystackSecretMasked] = useState<string | null>(null);
  const [paymentProvider, setPaymentProvider] = useState<'PAYSTACK' | 'FLUTTERWAVE' | 'OTHER'>('PAYSTACK');
  const [flutterwaveForm, setFlutterwaveForm] = useState({ enabled: false, publicKey: '', secretKey: '', webhookSecret: '' });
  const [flutterwaveSecretMasked, setFlutterwaveSecretMasked] = useState<string | null>(null);
  const [flutterwaveWebhookMasked, setFlutterwaveWebhookMasked] = useState<string | null>(null);
  const [emailForm, setEmailForm] = useState({ enabled: false, host: '', port: '465', user: '', pass: '', fromEmail: '', fromName: '' });
  const [emailPassMasked, setEmailPassMasked] = useState<string | null>(null);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [snapshots, setSnapshots] = useState<{ id: string; file: string; sizeLabel: string; createdAt: string }[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotsError, setSnapshotsError] = useState('');
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [snapshotUploadFile, setSnapshotUploadFile] = useState<File | null>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const [restoreModalId, setRestoreModalId] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const restoreSnap = restoreModalId ? snapshots.find(s => s.id === restoreModalId) : null;

  useEffect(() => {
    if (!accessToken) return;
    api<TenantSettings>('/tenant/settings').then(t => {
      setTenant(t);
      setCompanyForm({
        name: t.name ?? '',
        logoUrl: t.profile.logoUrl ?? '',
        email: t.profile.email ?? '',
        phone: t.profile.phone ?? '',
        address: t.profile.address ?? '',
      });
      setBillingForm({ vatRate: String(t.billing.vatRate), invoicePrefix: t.billing.invoicePrefix });
      setInstallationForm({
        fiberFee: String(Math.round((t.installation?.fiberFeeKobo ?? 5000000) / 100)),
        radioFee: String(Math.round((t.installation?.radioFeeKobo ?? 12000000) / 100)),
      });
      setPaystackForm({ enabled: t.paystack?.enabled ?? false, publicKey: t.paystack?.publicKey ?? '', secretKey: '' });
      setPaystackSecretMasked(t.paystack?.secretMasked ?? null);
      const prov = (t as any).paymentProvider ?? 'PAYSTACK';
      setPaymentProvider(prov === 'FLUTTERWAVE' ? 'FLUTTERWAVE' : prov === 'OTHER' ? 'OTHER' : 'PAYSTACK');
      setFlutterwaveForm({ enabled: (t as any).flutterwave?.enabled ?? false, publicKey: (t as any).flutterwave?.publicKey ?? '', secretKey: '', webhookSecret: '' });
      setFlutterwaveSecretMasked((t as any).flutterwave?.secretMasked ?? null);
      setFlutterwaveWebhookMasked((t as any).flutterwave?.webhookSecretMasked ?? null);
      setEmailForm({
        enabled: t.email?.enabled ?? false,
        host: t.email?.host ?? '',
        port: t.email?.port != null ? String(t.email.port) : '465',
        user: t.email?.user ?? '',
        pass: '',
        fromEmail: t.email?.fromEmail ?? '',
        fromName: t.email?.fromName ?? '',
      });
      setEmailPassMasked(t.email?.passMasked ?? null);
    }).catch(() => {});
  }, [accessToken]);

  async function saveCompany() {
    setSavingSettings(true);
    try {
      const res = await api<{ persisted: string[]; pending: string[]; message?: string }>('/tenant/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          name: companyForm.name.trim() || undefined,
          logoUrl: companyForm.logoUrl.trim() || undefined,
          email: companyForm.email.trim() || undefined,
          phone: companyForm.phone.trim() || undefined,
          address: companyForm.address.trim() || undefined,
        }),
      });
      toast(res.pending?.length ? (res.message ?? 'Saved — some fields are not persisted yet') : 'Company settings saved', 'success', toasts, setToasts);
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save company settings', 'error', toasts, setToasts);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveBilling() {
    setSavingSettings(true);
    try {
      const res = await api<{ persisted: string[]; pending: string[]; message?: string }>('/tenant/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          vatRate: billingForm.vatRate === '' ? undefined : Number(billingForm.vatRate),
          invoicePrefix: billingForm.invoicePrefix.trim() || undefined,
        }),
      });
      toast(res.pending?.length ? (res.message ?? 'Saved — some fields are not persisted yet') : 'Billing defaults saved', 'success', toasts, setToasts);
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save billing defaults', 'error', toasts, setToasts);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveInstallation() {
    setSavingSettings(true);
    try {
      const fiberKobo = installationForm.fiberFee === '' ? undefined : Math.round(parseFloat(installationForm.fiberFee) * 100);
      const radioKobo = installationForm.radioFee === '' ? undefined : Math.round(parseFloat(installationForm.radioFee) * 100);
      if (fiberKobo !== undefined && (isNaN(fiberKobo) || fiberKobo < 0)) { toast('Fiber fee must be a valid number', 'error', toasts, setToasts); return; }
      if (radioKobo !== undefined && (isNaN(radioKobo) || radioKobo < 0)) { toast('Radio fee must be a valid number', 'error', toasts, setToasts); return; }
      await api('/tenant/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          fiberInstallationFeeKobo: fiberKobo,
          radioInstallationFeeKobo: radioKobo,
        }),
      });
      const t = await api<TenantSettings>('/tenant/settings');
      setTenant(t);
      setInstallationForm({
        fiberFee: String(Math.round((t.installation?.fiberFeeKobo ?? 5000000) / 100)),
        radioFee: String(Math.round((t.installation?.radioFeeKobo ?? 12000000) / 100)),
      });
      toast('Installation fees saved', 'success', toasts, setToasts);
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save installation fees', 'error', toasts, setToasts);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveEmail() {
    setSavingSettings(true);
    try {
      await api('/tenant/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          smtpEnabled: emailForm.enabled,
          smtpHost: emailForm.host.trim() || undefined,
          smtpPort: emailForm.port === '' ? undefined : Number(emailForm.port),
          smtpUser: emailForm.user.trim() || undefined,
          smtpPass: emailForm.pass.trim() || undefined,
          smtpFromEmail: emailForm.fromEmail.trim() || undefined,
          smtpFromName: emailForm.fromName.trim() || undefined,
        }),
      });
      const t = await api<TenantSettings>('/tenant/settings');
      setTenant(t);
      setEmailForm({
        enabled: t.email.enabled,
        host: t.email.host ?? '',
        port: t.email.port != null ? String(t.email.port) : '465',
        user: t.email.user ?? '',
        pass: '',
        fromEmail: t.email.fromEmail ?? '',
        fromName: t.email.fromName ?? '',
      });
      setEmailPassMasked(t.email.passMasked);
      toast('Email settings saved', 'success', toasts, setToasts);
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save email settings', 'error', toasts, setToasts);
    } finally {
      setSavingSettings(false);
    }
  }

  async function verifySmtp() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api<{ ok: boolean; message: string }>('/tenant/settings/smtp/verify');
      setVerifyResult(res);
      toast(res.message, res.ok ? 'success' : 'error', toasts, setToasts);
    } catch (e: any) {
      const msg = e?.message ?? 'Verification failed';
      setVerifyResult({ ok: false, message: msg });
      toast(msg, 'error', toasts, setToasts);
    } finally {
      setVerifying(false);
    }
  }

  async function sendTestEmail() {
    if (!testTo.trim() || !/.+@.+\..+/.test(testTo.trim())) { toast('Enter a valid email for the test', 'error', toasts, setToasts); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api<{ ok: boolean; message: string }>('/tenant/settings/test-email', { method: 'POST', body: JSON.stringify({ to: testTo.trim() }) });
      setTestResult(res);
      toast(res.message, res.ok ? 'success' : 'error', toasts, setToasts);
    } catch (e: any) {
      const msg = e?.message ?? 'Test failed';
      setTestResult({ ok: false, message: msg });
      toast(msg, 'error', toasts, setToasts);
    } finally {
      setTesting(false);
    }
  }

  async function savePaystack() {
    setSavingSettings(true);
    try {
      const body: any = { paymentProvider };
      if (paymentProvider === 'PAYSTACK') {
        body.paystackEnabled = paystackForm.enabled;
        body.paystackPublicKey = paystackForm.publicKey.trim() || undefined;
        if (paystackForm.secretKey.trim()) body.paystackSecretKey = paystackForm.secretKey.trim();
      } else if (paymentProvider === 'FLUTTERWAVE') {
        body.flutterwaveEnabled = flutterwaveForm.enabled;
        body.flutterwavePublicKey = flutterwaveForm.publicKey.trim() || undefined;
        if (flutterwaveForm.secretKey.trim()) body.flutterwaveSecretKey = flutterwaveForm.secretKey.trim();
        if (flutterwaveForm.webhookSecret.trim()) body.flutterwaveWebhookSecret = flutterwaveForm.webhookSecret.trim();
      }
      await api('/tenant/settings', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const t = await api<TenantSettings>('/tenant/settings');
      setTenant(t);
      setPaystackForm({ enabled: t.paystack.enabled, publicKey: t.paystack.publicKey ?? '', secretKey: '' });
      setPaystackSecretMasked(t.paystack.secretMasked);
      const prov = (t as any).paymentProvider ?? 'PAYSTACK';
      setPaymentProvider(prov === 'FLUTTERWAVE' ? 'FLUTTERWAVE' : prov === 'OTHER' ? 'OTHER' : 'PAYSTACK');
      setFlutterwaveForm({ enabled: (t as any).flutterwave?.enabled ?? false, publicKey: (t as any).flutterwave?.publicKey ?? '', secretKey: '', webhookSecret: '' });
      setFlutterwaveSecretMasked((t as any).flutterwave?.secretMasked ?? null);
      setFlutterwaveWebhookMasked((t as any).flutterwave?.webhookSecretMasked ?? null);
      toast('Payment gateway settings saved', 'success', toasts, setToasts);
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save payment gateway settings', 'error', toasts, setToasts);
    } finally {
      setSavingSettings(false);
    }
  }

  async function fetchSnapshots() {
    setSnapshotsLoading(true);
    setSnapshotsError('');
    try {
      const data = await api<{ id: string; file: string; sizeLabel: string; createdAt: string }[]>('/snapshots');
      setSnapshots(data);
    } catch (e: any) {
      setSnapshotsError(e?.message ?? 'Failed to load snapshots');
    } finally {
      setSnapshotsLoading(false);
    }
  }

  async function createSnapshot() {
    setCreatingSnapshot(true);
    setSnapshotsError('');
    try {
      const snap = await api<{ id: string; file: string; sizeLabel: string; createdAt: string }>('/snapshots', { method: 'POST', body: JSON.stringify({}) });
      toast(`Snapshot created — ${snap.file} (${snap.sizeLabel})`, 'success', toasts, setToasts);
      fetchSnapshots();
    } catch (e: any) {
      toast(e?.message ?? 'Snapshot failed', 'error', toasts, setToasts);
      setSnapshotsError(e?.message ?? 'Snapshot failed');
    } finally {
      setCreatingSnapshot(false);
    }
  }

  async function restoreSnapshot(id: string) {
    setRestoringId(id);
    try {
      await api(`/snapshots/${id}/restore`, { method: 'POST', body: JSON.stringify({}) });
      toast('Restore completed — reloading', 'success', toasts, setToasts);
      setRestoreModalId(null);
      setRestoreConfirmText('');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      toast(e?.message ?? 'Restore failed', 'error', toasts, setToasts);
    } finally {
      setRestoringId(null);
    }
  }

  async function deleteSnapshot(id: string) {
    if (!confirm(`Delete snapshot "${id}"?`)) return;
    try {
      await api(`/snapshots/${id}`, { method: 'DELETE' });
      toast('Snapshot deleted', 'success', toasts, setToasts);
      fetchSnapshots();
    } catch (e: any) {
      toast(e?.message ?? 'Delete failed', 'error', toasts, setToasts);
    }
  }

  async function downloadSnapshot(id: string, file: string) {
    try {
      const res = await fetch(`/api/v1/snapshots/${id}/download`, { headers: { Authorization: `Bearer ${accessToken?.replace('Bearer ', '')}` } });
      // Fallback to api() blob handling via direct link
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file; a.click(); URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab (next will proxy)
      window.open(`/api/v1/snapshots/${id}/download`, '_blank');
    }
  }

  async function uploadSnapshot() {
    if (!snapshotUploadFile) { toast('Choose a .dump or .sql file first', 'error', toasts, setToasts); return; }
    const name = snapshotUploadFile.name.toLowerCase();
    if (!name.endsWith('.dump') && !name.endsWith('.sql')) { toast('Only .dump or .sql files are accepted', 'error', toasts, setToasts); return; }
    try {
      await apiUpload('/snapshots/upload', snapshotUploadFile);
      toast('Snapshot uploaded', 'success', toasts, setToasts);
      setSnapshotUploadFile(null);
      if (snapshotInputRef.current) snapshotInputRef.current.value = '';
      fetchSnapshots();
    } catch (e: any) {
      toast(e?.message ?? 'Upload failed', 'error', toasts, setToasts);
    }
  }

  useEffect(() => {
    if (tab === 'Backup' && accessToken) fetchSnapshots();
  }, [tab, accessToken]);

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

  function openCreateRole() {
    setEditRoleId(null);
    setRoleForm({ name: '', permissions: MODULES.map(m => ({ module: m, canView: false, canCreate: false, canEdit: false, canDelete: false })) });
    setShowRoleForm(true);
  }

  function openEditRole(role: CustomRoleFull) {
    setEditRoleId(role.id);
    const map = new Map(role.permissions.map(p => [p.module, p]));
    setRoleForm({
      name: role.name,
      permissions: MODULES.map(m => {
        const p = map.get(m);
        return p
          ? { module: m, canView: p.canView, canCreate: p.canCreate, canEdit: p.canEdit, canDelete: p.canDelete }
          : { module: m, canView: false, canCreate: false, canEdit: false, canDelete: false };
      }),
    });
    setShowRoleForm(true);
  }

  function setRolePerm(module: string, key: 'canView' | 'canCreate' | 'canEdit' | 'canDelete') {
    setRoleForm(f => ({
      ...f,
      permissions: f.permissions.map(p => {
        if (p.module !== module) return p;
        const next = { ...p, [key]: !p[key] };
        if (key === 'canView' && !next.canView) { next.canCreate = false; next.canEdit = false; next.canDelete = false; }
        if (key !== 'canView' && next[key]) next.canView = true;
        return next;
      }),
    }));
  }

  async function saveRole() {
    if (!roleForm.name.trim()) { toast('Role name is required', 'error', toasts, setToasts); return; }
    setRoleSaving(true);
    try {
      const body = JSON.stringify({ name: roleForm.name.trim(), permissions: roleForm.permissions });
      if (editRoleId) await api(`/custom-roles/${editRoleId}`, { method: 'PATCH', body });
      else await api('/custom-roles', { method: 'POST', body });
      setRoles(await api<CustomRoleFull[]>('/custom-roles'));
      setShowRoleForm(false);
      toast(editRoleId ? 'Role updated' : 'Role created', 'success', toasts, setToasts);
    } catch (e: any) { toast(e?.message ?? 'Failed to save role', 'error', toasts, setToasts); }
    finally { setRoleSaving(false); }
  }

  async function deleteRole(role: CustomRoleFull) {
    if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try {
      await api(`/custom-roles/${role.id}`, { method: 'DELETE' });
      setRoles(prev => prev.filter(r => r.id !== role.id));
      toast('Role deleted', 'success', toasts, setToasts);
    } catch (e: any) { toast(e?.message ?? 'Failed to delete role', 'error', toasts, setToasts); }
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

      <div className="badge-tabs" style={{ width: 'fit-content', maxWidth: '100%' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`tab-item${tab === t ? ' active' : ''}`}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600, whiteSpace: 'nowrap' }}>
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
          <div className="data-card users-table-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>EMAIL</th>
                    <th>ROLE</th>
                    <th>SUPER ADMIN</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No admin users found</td></tr>
                  ) : filteredUsers.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>
                        {u.email}
                        {u.id === currentUser?.id && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#F15925' }}>(you)</span>}
                      </td>
                      <td>
                        <select value={u.customRoleId || ''} onChange={e => changeRole(u.id, e.target.value || null)}
                          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: '0.8rem', background: '#fff' }}>
                          <option value="">— No Role —</option>
                          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <ToggleBtn on={u.isSuperAdmin || false} onClick={() => toggleSuperAdmin(u.id, u.isSuperAdmin || false)} />
                      </td>
                      <td>
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
          <div className="users-mobile-list">
            {filteredUsers.length === 0 ? (
              <div className="data-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No admin users found</div>
            ) : filteredUsers.map(u => (
              <div key={u.id} className="data-card" style={{ padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', wordBreak: 'break-all' }}>
                  {u.email}
                  {u.id === currentUser?.id && <span style={{ marginLeft: 6, fontSize: '0.7rem', color: '#F15925' }}>(you)</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <select value={u.customRoleId || ''} onChange={e => changeRole(u.id, e.target.value || null)}
                    style={{ flex: '1 1 160px', padding: '7px 10px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: '0.8rem', background: '#fff' }}>
                    <option value="">— No Role —</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Super admin
                    <ToggleBtn on={u.isSuperAdmin || false} onClick={() => toggleSuperAdmin(u.id, u.isSuperAdmin || false)} />
                  </label>
                </div>
                <button onClick={() => resetPassword(u.id, u.email)} className="btn-sm-outline" style={{ marginTop: 12 }}>
                  Reset Password
                </button>
              </div>
            ))}
          </div>
        </>
      ) : tab === 'Roles' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>{roles.length} custom roles defined</p>
            <button className="btn-primary" onClick={openCreateRole}>
              Create Role <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
          {roles.length === 0 ? (
            <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No roles created yet</div>
          ) : roles.map(role => {
            const permMap = new Map(role.permissions.map(p => [p.module, p]));
            return (
              <div key={role.id} className="data-card" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{role.name}</strong>
                    {role._count && <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{role._count.users} user{role._count.users === 1 ? '' : 's'}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-sm-outline" onClick={() => openEditRole(role)}>Edit</button>
                    <button className="btn-sm-outline" style={{ color: '#DC2626', borderColor: '#DC2626' }} onClick={() => deleteRole(role)}>Delete</button>
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
        <div className="data-card" style={{ padding: 20, maxWidth: 460 }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 4 }}>Change your password</h3>
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
      ) : tab === 'Company' ? (
        <div className="data-card" style={{ padding: 20, maxWidth: 860 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Company Profile</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Tenant {tenant?.slug ?? '—'} · shown to customers and used on documents</div>
            </div>
            <button className="btn-primary" disabled={savingSettings} onClick={saveCompany}>{savingSettings ? 'Saving…' : 'Save Changes'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div>
              <label style={fieldLabel}>Company name</label>
              <input value={companyForm.name} onChange={e => setCompanyForm(f => ({ ...f, name: e.target.value }))} placeholder="Hi-Konnect Networks" style={fieldInput} />
            </div>
            <div>
              <label style={fieldLabel}>Logo URL <span style={pendingTag}>not persisted yet</span></label>
              <input value={companyForm.logoUrl} onChange={e => setCompanyForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://…/logo.png" style={fieldInput} />
            </div>
            <div>
              <label style={fieldLabel}>Contact email <span style={pendingTag}>not persisted yet</span></label>
              <input value={companyForm.email} onChange={e => setCompanyForm(f => ({ ...f, email: e.target.value }))} placeholder="support@example.com" style={fieldInput} />
            </div>
            <div>
              <label style={fieldLabel}>Phone <span style={pendingTag}>not persisted yet</span></label>
              <input value={companyForm.phone} onChange={e => setCompanyForm(f => ({ ...f, phone: e.target.value }))} placeholder="+234 …" style={fieldInput} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={fieldLabel}>Address <span style={pendingTag}>not persisted yet</span></label>
              <input value={companyForm.address} onChange={e => setCompanyForm(f => ({ ...f, address: e.target.value }))} placeholder="Street, city, state" style={fieldInput} />
            </div>
          </div>
          <p style={pendingNote}>
            <strong>Only Company name is stored today</strong> (the <code>Tenant.name</code> column). The logo, contact and address fields have no database column yet — saving them is logged server-side and reported back, pending the deferred schema work.
          </p>
        </div>
      ) : tab === 'Integrations' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
          <div className="data-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#FFF7ED 0%, #FFFFFF 60%, #EFF6FF 100%)', border: '1px solid #FFE7D6' }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#F15925 0%, #FF8A4C 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
              <Plug2 size={18} strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-dark)', letterSpacing: '-0.2px' }}>Integrations</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 500 }}>Configure fees, billing and external services</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: '0.66rem', fontWeight: 800, color: '#94A3B8', background: '#fff', border: '1px solid #E2E8F0', padding: '4px 9px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Settings2 size={12} strokeWidth={2} /> 4 services</span>
          </div>

          <div className="badge-tabs" style={{ width: 'fit-content', maxWidth: '100%', background: '#F8FAFC', border: '1px solid #F1F5F9', padding: 3 }}>
            {[
              { key: 'Installation' as const, label: 'Installation', icon: Wrench },
              { key: 'Billing Defaults' as const, label: 'Billing', icon: FileText },
              { key: 'Payment Gateway' as const, label: 'Payment Gateway', icon: CreditCard },
              { key: 'Email' as const, label: 'Email', icon: Mail },
            ].map(s => {
              const Icon = s.icon;
              const active = integrationTab === s.key;
              return (
                <button key={s.key} onClick={() => setIntegrationTab(s.key)} className={`tab-item${active ? ' active' : ''}`} style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 700, fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  <Icon size={13} strokeWidth={2} style={{ opacity: active ? 1 : 0.6 }} />
                  {s.label}
                </button>
              );
            })}
          </div>

          {integrationTab === 'Installation' && (
            <div className="data-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: '#FFF7ED', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F59E0B' }}><Wrench size={16} strokeWidth={2} /></div>
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-dark)' }}>Installation Fees</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>One-off fees by network type</div>
                  </div>
                </div>
                <button className="btn-primary" disabled={savingSettings} onClick={saveInstallation}>{savingSettings ? 'Saving…' : 'Save'}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>Fiber Installation Fee (₦)</label>
                  <input type="text" inputMode="decimal" value={installationForm.fiberFee} onChange={e => setInstallationForm(f => ({ ...f, fiberFee: e.target.value }))} placeholder="50000" style={fieldInput} />
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>Applies when Network type is <b>Fiber</b></div>
                </div>
                <div>
                  <label style={fieldLabel}>Radio Installation Fee (₦)</label>
                  <input type="text" inputMode="decimal" value={installationForm.radioFee} onChange={e => setInstallationForm(f => ({ ...f, radioFee: e.target.value }))} placeholder="120000" style={fieldInput} />
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>Applies when Network type is <b>Radio</b></div>
                </div>
              </div>
              <div style={{ marginTop: 14, padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, fontSize: '0.78rem', color: '#166534', lineHeight: 1.5 }}>
                These fees are used as the default when creating a customer. Selecting <b>Fiber</b> auto-fills <b>₦{installationForm.fiberFee || '50000'}</b>, <b>Radio</b> auto-fills <b>₦{installationForm.radioFee || '120000'}</b> — you can still edit the fee per customer before saving. One-off only, not part of the plan.
              </div>
            </div>
          )}

          {integrationTab === 'Billing Defaults' && (
            <div className="data-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: '#EFF6FF', border: '1px solid #DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}><FileText size={16} strokeWidth={2} /></div>
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-dark)' }}>Billing Defaults</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Applied to new invoices once persistence lands</div>
                  </div>
                </div>
                <button className="btn-primary" disabled={savingSettings} onClick={saveBilling}>{savingSettings ? 'Saving…' : 'Save'}</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>VAT rate (%) <span style={pendingTag}>not applied</span></label>
                  <input type="number" step="0.5" min="0" max="100" value={billingForm.vatRate} onChange={e => setBillingForm(f => ({ ...f, vatRate: e.target.value }))} style={fieldInput} />
                </div>
                <div>
                  <label style={fieldLabel}>Invoice prefix <span style={pendingTag}>not applied</span></label>
                  <input value={billingForm.invoicePrefix} onChange={e => setBillingForm(f => ({ ...f, invoicePrefix: e.target.value }))} placeholder="INV" style={fieldInput} />
                </div>
              </div>
              <p style={pendingNote}>
                <strong>Not applied yet.</strong> VAT is currently hardcoded at 7.5% in the invoice generators (billing-service, payments-service, api jobs) and invoice numbering uses each service's own sequence. These fields have no <code>Tenant</code> columns yet — values are logged and reported back pending schema work.
              </p>
            </div>
          )}

          {integrationTab === 'Payment Gateway' && (
            <div className="data-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: '#F0FDF4', border: '1px solid #BBF7D0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16A34A' }}><CreditCard size={16} strokeWidth={2} /></div>
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-dark)' }}>Payment Gateway</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Payment service and customer checkout</div>
                  </div>
                </div>
                <button className="btn-primary" disabled={savingSettings} onClick={savePaystack}>{savingSettings ? 'Saving…' : 'Save'}</button>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={fieldLabel}>Active Provider</label>
                <select value={paymentProvider} onChange={e => setPaymentProvider(e.target.value as any)} style={{ ...fieldInput, maxWidth: 320, cursor: 'pointer' }}>
                  <option value="PAYSTACK">Paystack</option>
                  <option value="FLUTTERWAVE">Flutterwave</option>
                  <option value="OTHER">Other (Manual / Bank Transfer)</option>
                </select>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>Selected gateway is used for all customer checkouts. Configure its keys below.</div>
              </div>

              {paymentProvider === 'PAYSTACK' && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, marginBottom: 16, cursor: 'pointer' }}>
                    <input type="checkbox" checked={paystackForm.enabled} onChange={e => setPaystackForm(f => ({ ...f, enabled: e.target.checked }))} style={{ width: 16, height: 16 }} />
                    Enable Paystack payments
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={fieldLabel}>Public key</label>
                      <input value={paystackForm.publicKey} onChange={e => setPaystackForm(f => ({ ...f, publicKey: e.target.value }))} placeholder="pk_live_…" style={fieldInput} />
                    </div>
                    <div>
                      <label style={fieldLabel}>
                        Secret key
                        {paystackSecretMasked && <span style={{ ...pendingTag, background: '#F1F5F9', color: '#475569' }}>saved: {paystackSecretMasked}</span>}
                      </label>
                      <input type="password" value={paystackForm.secretKey} onChange={e => setPaystackForm(f => ({ ...f, secretKey: e.target.value }))}
                        placeholder={paystackSecretMasked ? 'Leave blank to keep current' : 'sk_live_…'} autoComplete="new-password" style={fieldInput} />
                      <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Write-only: stored encrypted and never shown again after saving.</p>
                    </div>
                  </div>
                  <p style={{ marginTop: 16, fontSize: '0.78rem', color: '#1D4ED8', background: '#EFF6FF', padding: '10px 14px', borderRadius: 10, lineHeight: 1.55 }}>
                    When enabled, these keys replace the <code>PAYSTACK_*</code> environment variables at runtime for the payment service and customer checkout.
                    Production requires a <code>CREDENTIALS_ENCRYPTION_KEY</code> env var to encrypt/decrypt the secret.
                  </p>
                </>
              )}

              {paymentProvider === 'FLUTTERWAVE' && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, marginBottom: 16, cursor: 'pointer' }}>
                    <input type="checkbox" checked={flutterwaveForm.enabled} onChange={e => setFlutterwaveForm(f => ({ ...f, enabled: e.target.checked }))} style={{ width: 16, height: 16 }} />
                    Enable Flutterwave payments
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={fieldLabel}>Public key</label>
                      <input value={flutterwaveForm.publicKey} onChange={e => setFlutterwaveForm(f => ({ ...f, publicKey: e.target.value }))} placeholder="FLWPUBK-…" style={fieldInput} />
                    </div>
                    <div>
                      <label style={fieldLabel}>
                        Secret key
                        {flutterwaveSecretMasked && <span style={{ ...pendingTag, background: '#F1F5F9', color: '#475569' }}>saved: {flutterwaveSecretMasked}</span>}
                      </label>
                      <input type="password" value={flutterwaveForm.secretKey} onChange={e => setFlutterwaveForm(f => ({ ...f, secretKey: e.target.value }))}
                        placeholder={flutterwaveSecretMasked ? 'Leave blank to keep current' : 'FLWSECK-…'} autoComplete="new-password" style={fieldInput} />
                      <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Write-only: stored encrypted.</p>
                    </div>
                    <div>
                      <label style={fieldLabel}>
                        Webhook secret (verif-hash)
                        {flutterwaveWebhookMasked && <span style={{ ...pendingTag, background: '#F1F5F9', color: '#475569' }}>saved: {flutterwaveWebhookMasked}</span>}
                      </label>
                      <input type="password" value={flutterwaveForm.webhookSecret} onChange={e => setFlutterwaveForm(f => ({ ...f, webhookSecret: e.target.value }))}
                        placeholder={flutterwaveWebhookMasked ? 'Leave blank to keep current' : 'Webhook hash'} autoComplete="new-password" style={fieldInput} />
                      <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Set the same hash in Flutterwave dashboard → Webhooks. Used to verify <code>verif-hash</code> header.</p>
                    </div>
                  </div>
                  <p style={{ marginTop: 16, fontSize: '0.78rem', color: '#1D4ED8', background: '#EFF6FF', padding: '10px 14px', borderRadius: 10, lineHeight: 1.55 }}>
                    When enabled, Flutterwave keys replace <code>FLUTTERWAVE_*</code> env vars at runtime. Webhook: <code>api.hikonnectng.com/api/v1/payments/webhook/flutterwave</code>
                  </p>
                </>
              )}

              {paymentProvider === 'OTHER' && (
                <div style={{ padding: '14px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-dark)', marginBottom: 6 }}>Manual / Other gateway</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    No external checkout is initialized. Invoices are created as <b>PENDING</b> and marked <b>PAID</b> manually via <code>BANK_TRANSFER</code> (e.g., after confirming bank alert or POS). Use the billing service to record offline payments.
                  </div>
                  <div style={{ marginTop: 10, fontSize: '0.78rem', color: '#92400E', background: '#FEF3C7', padding: '8px 12px', borderRadius: 8 }}>
                    Customers will see a bank-transfer instruction instead of a Paystack/Flutterwave popup.
                  </div>
                </div>
              )}
            </div>
          )}

          {integrationTab === 'Email' && (
            <div className="data-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: '#FFF7ED', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EA580C' }}><Mail size={16} strokeWidth={2} /></div>
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-dark)' }}>Brevo SMTP</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Invoices, receipts and notifications</div>
                  </div>
                </div>
                <button className="btn-primary" disabled={savingSettings} onClick={saveEmail}>{savingSettings ? 'Saving…' : 'Save'}</button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, marginBottom: 16, cursor: 'pointer' }}>
                <input type="checkbox" checked={emailForm.enabled} onChange={e => setEmailForm(f => ({ ...f, enabled: e.target.checked }))} style={{ width: 16, height: 16 }} />
                Use these SMTP settings
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>SMTP host</label>
                  <input value={emailForm.host} onChange={e => setEmailForm(f => ({ ...f, host: e.target.value }))} placeholder="smtp-relay.brevo.com" style={fieldInput} />
                </div>
                <div>
                  <label style={fieldLabel}>Port</label>
                  <input type="number" min="1" max="65535" value={emailForm.port} onChange={e => setEmailForm(f => ({ ...f, port: e.target.value }))} placeholder="465" style={fieldInput} />
                </div>
                <div>
                  <label style={fieldLabel}>SMTP username</label>
                  <input value={emailForm.user} onChange={e => setEmailForm(f => ({ ...f, user: e.target.value }))} placeholder="you@smtp-brevo.com" style={fieldInput} />
                </div>
                <div>
                  <label style={fieldLabel}>
                    SMTP password
                    {emailPassMasked && <span style={{ ...pendingTag, background: '#F1F5F9', color: '#475569' }}>saved: {emailPassMasked}</span>}
                  </label>
                  <input type="password" value={emailForm.pass} onChange={e => setEmailForm(f => ({ ...f, pass: e.target.value }))}
                    placeholder={emailPassMasked ? 'Leave blank to keep current' : 'Brevo SMTP key'} autoComplete="new-password" style={fieldInput} />
                </div>
                <div>
                  <label style={fieldLabel}>From email</label>
                  <input value={emailForm.fromEmail} onChange={e => setEmailForm(f => ({ ...f, fromEmail: e.target.value }))} placeholder="noreply@example.com" style={fieldInput} />
                </div>
                <div>
                  <label style={fieldLabel}>From name</label>
                  <input value={emailForm.fromName} onChange={e => setEmailForm(f => ({ ...f, fromName: e.target.value }))} placeholder="Hi-Konnect Networks" style={fieldInput} />
                </div>
              </div>
              <div style={{ marginTop: 18, padding: '14px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={verifySmtp} disabled={verifying} style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid #E2E8F0', background: verifying ? '#F1F5F9' : '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: verifying ? 'not-allowed' : 'pointer', opacity: verifying ? 0.7 : 1 }}>
                    {verifying ? 'Verifying…' : 'Verify Connection'}
                  </button>
                  {verifyResult && <span style={{ fontSize: '0.78rem', color: verifyResult.ok ? '#16A34A' : '#DC2626', fontWeight: 600 }}>{verifyResult.message}</span>}
                </div>
                <div style={{ height: 1, background: '#E2E8F0' }} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="test@example.com — recipient for test email" style={{ flex: '1 1 220px', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none' }} />
                  <button onClick={sendTestEmail} disabled={testing || !testTo.trim()} style={{ padding: '9px 16px', borderRadius: 999, border: 'none', background: testing || !testTo.trim() ? '#E2E8F0' : '#F15925', color: testing || !testTo.trim() ? '#94A3B8' : '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: testing || !testTo.trim() ? 'not-allowed' : 'pointer' }}>
                    {testing ? 'Sending…' : 'Send Test Email'}
                  </button>
                </div>
                {testResult && <div style={{ fontSize: '0.78rem', padding: '8px 12px', borderRadius: 8, background: testResult.ok ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${testResult.ok ? '#BBF7D0' : '#FECACA'}`, color: testResult.ok ? '#166534' : '#991B1B' }}>{testResult.message}</div>}
                <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Sends a real email via the dashboard SMTP — check inbox and server Mail logs if it fails. Save first if you just edited credentials.</div>
              </div>
              <p style={{ marginTop: 16, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                Password is write-only and stored encrypted. When enabled, these settings are the <strong>sole source</strong> for all outgoing mail — <code>SMTP_*</code> env vars are ignored. Use port <strong>465</strong> (TLS) — port 587 is blocked on the server.
              </p>
            </div>
          )}
        </div>      ) : tab === 'Backup' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860 }}>
          {/* Hero — single light #FFFFFF, soft, no gradient */}
          <div className="data-card" style={{ padding: 0, overflow: 'hidden', background: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            <div style={{ padding: '18px 20px', display: 'flex', gap: 16, alignItems: 'flex-start', background: '#FFFFFF', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><polyline points="12 22 12 12"/><polyline points="7 12 12 7 17 12"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0F172A', letterSpacing: -0.3 }}>Backup & Restore</div>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#0F172A', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '4px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: '#10B981' }} />{snapshots.length} snapshots</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', background: '#FFFFFF', border: '1px solid #F1F5F9', padding: '4px 8px', borderRadius: 999 }}>Auto-saved to backups/snapshots</span>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#64748B', lineHeight: 1.5, marginTop: 6 }}>One file restores <b style={{ color: '#0F172A' }}>everything</b> — dashboard, tenant settings, customers, chats, tickets, invoices, payments and radius. Download to keep off-site, upload to bring back.</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
                <button onClick={createSnapshot} disabled={creatingSnapshot} style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid #0F172A', background: creatingSnapshot ? '#F1F5F9' : '#0F172A', color: creatingSnapshot ? '#94A3B8' : '#fff', fontWeight: 700, fontSize: '0.85rem', cursor: creatingSnapshot ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(15,23,42,0.12)', opacity: creatingSnapshot ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: creatingSnapshot ? 'spin 0.8s linear infinite' : 'none' }}><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><polyline points="12 22 12 12"/><polyline points="7 12 12 7 17 12"/></svg>
                  {creatingSnapshot ? 'Creating…' : 'Snapshot Now'}
                </button>
                <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 500 }}>Takes ~2–5s • no downtime</span>
              </div>
            </div>
            {/* Sweet 3-step workflow — single light pills, no gradients */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '14px 18px', background: '#F8FAFC', borderTop: '1px solid #F1F5F9' }}>
              {[
                { n: '1', title: 'Create', desc: 'Full pg_dump -Fc + radius', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
                { n: '2', title: 'Download', desc: 'Keep off-site or share', icon: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l12 5 7-10' },
                { n: '3', title: 'Restore', desc: 'One-click, full overwrite', icon: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5' },
              ].map(s => (
                <div key={s.n} style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: '12px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.72rem', flexShrink: 0 }}>{s.n}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}><svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d={s.icon} /></svg>{s.title}</div>
                    <div style={{ fontSize: '0.7rem', color: '#94A3B8', lineHeight: 1.3, marginTop: 1 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* What’s inside — 6 pills */}
            <div style={{ padding: '12px 18px', display: 'flex', flexWrap: 'wrap', gap: 6, background: '#FFFFFF', borderTop: '1px solid #F1F5F9' }}>
              {['Dashboard','Tenant settings','Customers','Chats & Tickets','Invoices','Radius'].map(t => (
                <span key={t} style={{ fontSize: '0.68rem', fontWeight: 600, padding: '5px 10px', borderRadius: 999, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#334155', display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: '#0F172A' }} />{t}</span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#94A3B8', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}><svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>Stored as single light file</span>
            </div>
            {snapshotsError && <div style={{ margin: '0 18px 14px', padding: '10px 12px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', borderRadius: 10, fontSize: '0.82rem' }}>{snapshotsError}</div>}
          </div>

          <div className="data-card" style={{ padding: 0, overflow: 'hidden', background: '#FFFFFF' }}>
            <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#FFFFFF', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>Snapshots</div>
                  <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{snapshots.length} file{snapshots.length === 1 ? '' : 's'} • newest first</div>
                </div>
              </div>
              <button onClick={fetchSnapshots} disabled={snapshotsLoading} style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: '#FFFFFF', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: snapshotsLoading ? 'spin 0.8s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Refresh
              </button>
            </div>

            {snapshotsLoading ? (
              <div style={{ padding: 28, textAlign: 'center', color: '#94A3B8', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 20, height: 20, border: '2px solid #E2E8F0', borderTopColor: '#0F172A', borderRadius: 999, display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
                Loading snapshots…
              </div>
            ) : snapshots.length === 0 ? (
              <div style={{ padding: '28px 18px', textAlign: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', color: '#94A3B8' }}>
                  <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><polyline points="12 22 12 12"/><polyline points="7 12 12 7 17 12"/></svg>
                </div>
                <div style={{ fontWeight: 700, color: '#0F172A', fontSize: '0.92rem' }}>No snapshots yet</div>
                <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: 4, maxWidth: 360, margin: '4px auto 0', lineHeight: 1.4 }}>Create your first backup — it captures everything and is ready to restore in one click.</div>
                <button onClick={createSnapshot} disabled={creatingSnapshot} style={{ marginTop: 14, padding: '9px 16px', borderRadius: 999, border: '1px solid #0F172A', background: '#0F172A', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><polyline points="12 22 12 12"/><polyline points="7 12 12 7 17 12"/></svg>
                  Create first snapshot
                </button>
              </div>
            ) : (
              <div style={{ maxHeight: 360, overflowY: 'auto' }} className="live-scroll">
                {snapshots.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid #F1F5F9', flexWrap: 'wrap', background: '#FFFFFF', transition: 'background 0.12s' }} onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')} onMouseLeave={e => (e.currentTarget.style.background = '#FFFFFF')}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0F172A', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {s.file}
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#334155', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '2px 6px', borderRadius: 999 }}>{s.sizeLabel}</span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{new Date(s.createdAt).toLocaleString()}</span>
                        <span style={{ width: 3, height: 3, borderRadius: 999, background: '#CBD5E1' }} />
                        <span>{s.id}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button onClick={() => downloadSnapshot(s.id, s.file)} style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: '#FFFFFF', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#334155' }}>
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download
                      </button>
                      <button onClick={() => { setRestoreModalId(s.id); setRestoreConfirmText(''); }} disabled={restoringId === s.id} style={{ padding: '7px 12px', borderRadius: 999, border: '1px solid #FECACA', background: restoringId === s.id ? '#F1F5F9' : '#FFFFFF', color: '#DC2626', fontSize: '0.75rem', fontWeight: 700, cursor: restoringId === s.id ? 'not-allowed' : 'pointer', opacity: restoringId === s.id ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        {restoringId === s.id ? 'Restoring…' : 'Restore'}
                      </button>
                      <button onClick={() => deleteSnapshot(s.id)} style={{ width: 32, height: 32, borderRadius: 999, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Delete">
                        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="data-card" style={{ padding: 16, background: '#FFFFFF' }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </span>
              Restore from file
              <span style={{ marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', background: '#F8FAFC', border: '1px solid #F1F5F9', padding: '4px 8px', borderRadius: 999 }}>Local + Download</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: 6, lineHeight: 1.5 }}>Upload a previously downloaded <code style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', padding: '2px 6px', borderRadius: 6, fontSize: '0.72rem' }}>.dump</code> or <code style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', padding: '2px 6px', borderRadius: 6, fontSize: '0.72rem' }}>.sql</code> to add it to the list, then <b style={{ color: '#0F172A' }}>Restore</b>. Copies to <code style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', padding: '2px 6px', borderRadius: 6, fontSize: '0.72rem' }}>backups/snapshots</code> on the server.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 12, padding: 10 }}>
              <label style={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1.5px dashed #CBD5E1', background: '#FFFFFF', cursor: 'pointer', minWidth: 0 }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', color: snapshotUploadFile ? '#0F172A' : '#94A3B8', fontWeight: snapshotUploadFile ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{snapshotUploadFile ? snapshotUploadFile.name : 'Choose .dump or .sql file…'}</span>
                <input ref={snapshotInputRef} type="file" accept=".dump,.sql" onChange={e => setSnapshotUploadFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '6px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>Browse</span>
              </label>
              <button onClick={uploadSnapshot} disabled={!snapshotUploadFile} style={{ padding: '10px 16px', borderRadius: 999, border: '1px solid #0F172A', background: snapshotUploadFile ? '#0F172A' : '#F1F5F9', color: snapshotUploadFile ? '#fff' : '#94A3B8', fontWeight: 700, fontSize: '0.82rem', cursor: snapshotUploadFile ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>Upload</button>
            </div>
            <div style={{ marginTop: 10, fontSize: '0.68rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 6 }}><svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>Uploads are saved locally and appear above — no auto-restore, you control when to click Restore.</div>
          </div>
          {restoreSnap && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.48)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setRestoreModalId(null); setRestoreConfirmText(''); }}>
                <div style={{ background: '#FFFFFF', borderRadius: 20, width: 480, maxWidth: '100%', boxShadow: '0 20px 60px rgba(15,23,42,0.18)', overflow: 'hidden', animation: 'pop 0.2s ease' }} onClick={e => e.stopPropagation()}>
                  <div style={{ padding: '20px 22px 16px', background: '#FFFFFF', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A', letterSpacing: -0.2 }}>Restore this snapshot?</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748B', marginTop: 2, lineHeight: 1.45 }}>This will <b style={{ color: '#DC2626' }}>wipe and replace</b> the entire database — dashboard, tenant settings, customers, chats, tickets, invoices, payments and radius will be overwritten. The app will reload after.</div>
                    </div>
                    <button onClick={() => { setRestoreModalId(null); setRestoreConfirmText(''); }} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>×</button>
                  </div>
                  <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, background: '#FFFFFF' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#0F172A', wordBreak: 'break-all' }}>{restoreSnap.file}</div>
                        <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{new Date(restoreSnap.createdAt).toLocaleString()} • {restoreSnap.sizeLabel} • {restoreSnap.id}</div>
                      </div>
                    </div>
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <svg width="14" height="14" fill="none" stroke="#DC2626" strokeWidth="1.8" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <div style={{ fontSize: '0.78rem', color: '#7F1D1D', lineHeight: 1.4 }}><b>Irreversible.</b> All current data will be replaced by the snapshot. Customers, chats and invoices created after this snapshot will be lost. Make sure you have a fresh snapshot if you need to keep them.</div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>Type <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '2px 6px', borderRadius: 6, fontSize: '0.75rem' }}>RESTORE</span> to confirm</label>
                      <input value={restoreConfirmText} onChange={e => setRestoreConfirmText(e.target.value)} placeholder="RESTORE" autoFocus style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${restoreConfirmText === 'RESTORE' ? '#0F172A' : '#E2E8F0'}`, background: restoreConfirmText === 'RESTORE' ? '#F8FAFC' : '#FFFFFF', fontSize: '0.85rem', fontWeight: 600, letterSpacing: 0.5, outline: 'none', boxSizing: 'border-box', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} />
                      <div style={{ fontSize: '0.68rem', color: restoreConfirmText === 'RESTORE' ? '#059669' : '#94A3B8', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{restoreConfirmText === 'RESTORE' ? <><svg width="12" height="12" fill="none" stroke="#059669" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Ready to restore</> : 'This protects against accidental clicks.'}</div>
                    </div>
                  </div>
                  <div style={{ padding: '14px 18px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#FFFFFF' }}>
                    <button onClick={() => { setRestoreModalId(null); setRestoreConfirmText(''); }} disabled={restoringId === restoreSnap.id} style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid #E2E8F0', background: '#FFFFFF', fontWeight: 600, fontSize: '0.82rem', cursor: restoringId === restoreSnap.id ? 'not-allowed' : 'pointer', color: '#334155', opacity: restoringId === restoreSnap.id ? 0.6 : 1 }}>Cancel</button>
                    <button onClick={() => restoreSnapshot(restoreSnap.id)} disabled={restoreConfirmText !== 'RESTORE' || restoringId === restoreSnap.id} style={{ padding: '10px 18px', borderRadius: 999, border: 'none', background: restoreConfirmText !== 'RESTORE' || restoringId === restoreSnap.id ? '#F1F5F9' : '#DC2626', color: restoreConfirmText !== 'RESTORE' || restoringId === restoreSnap.id ? '#94A3B8' : '#fff', fontWeight: 800, fontSize: '0.82rem', cursor: restoreConfirmText !== 'RESTORE' || restoringId === restoreSnap.id ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: restoreConfirmText !== 'RESTORE' || restoringId === restoreSnap.id ? 'none' : '0 4px 14px rgba(220,38,38,0.22)', opacity: restoringId === restoreSnap.id ? 0.9 : 1 }}>
                      {restoringId === restoreSnap.id ? <><span style={{ width: 14, height: 14, border: '2px solid #94A3B8', borderTopColor: 'transparent', borderRadius: 999, display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> Restoring…</> : 'Confirm restore'}
                    </button>
                  </div>
                </div>
              </div>
          )}
        </div>      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
          <div className="data-card" style={{ padding: 20 }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: 6 }}>Launch Customer Logins</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
              Generates a new password for <strong>every</strong> customer and emails them their login username, password, PPPoE/RADIUS username and the customer portal URL.
              <br />Use the test option below first to preview the email.
            </p>

            <div style={{ marginTop: 16, padding: 16, background: '#F8FAFC', borderRadius: 12, border: '1px solid var(--border-color)' }}>
              <label style={fieldLabel}>Send test email</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="you@example.com"
                  style={{ ...fieldInput, flex: '1 1 220px', width: 'auto' }} />
                <button onClick={launchTest} disabled={launching} className="btn-outline"
                  style={{ padding: '10px 20px', borderColor: 'var(--primary)', color: 'var(--primary)', opacity: launching ? 0.6 : 1, flexShrink: 0 }}>
                  {launching ? 'Sending…' : 'Send Test'}
                </button>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Sends a preview of the launch email to any address you enter. No account is changed — the credentials in it are samples.
              </p>
            </div>

            <div style={{ marginTop: 16, padding: 16, background: '#FEF5E7', borderRadius: 12, border: '1px solid #FDE68A' }}>
              <label style={{ ...fieldLabel, color: '#92400E' }}>Launch for all customers</label>
              {!launchConfirm ? (
                <button onClick={() => setLaunchConfirm(true)} className="btn-primary">
                  Launch All
                </button>
              ) : (
                <div style={{ fontSize: '0.85rem', color: '#92400E' }}>
                  <p style={{ margin: '0 0 10px 0' }}><strong>Warning:</strong> this resets every customer&apos;s password and emails them. Continue?</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={launchAll} disabled={launching} className="btn-primary"
                      style={{ background: '#DC2626', opacity: launching ? 0.6 : 1 }}>
                      {launching ? 'Launching…' : 'Yes, Launch All'}
                    </button>
                    <button onClick={() => setLaunchConfirm(false)} className="btn-outline">
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

      {showRoleForm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowRoleForm(false)}>
          <div style={{ background: 'white', padding: 32, width: 640, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{editRoleId ? 'Edit Role' : 'Create Role'}</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowRoleForm(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Role Name</label>
                <input value={roleForm.name} onChange={e => setRoleForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. ACCOUNTANT" style={inp} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Module Permissions</label>
                  <div style={{ display: 'flex', gap: 12, fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {(Object.keys(PERM_LABELS) as (keyof Permission)[]).map(k => <span key={k}>{PERM_LABELS[k]}</span>)}
                  </div>
                </div>
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, overflow: 'hidden' }}>
                  {roleForm.permissions.map((p, i) => (
                    <div key={p.module} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderTop: i ? '1px solid var(--border-color)' : 'none', background: p.canView ? '#F0FDF4' : '#fff' }}>
                      <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: p.canView ? 600 : 500, color: p.canView ? '#166534' : 'var(--text-color)' }}>{p.module}</span>
                      <div style={{ display: 'flex', gap: 24 }}>
                        {(['canView', 'canCreate', 'canEdit', 'canDelete'] as const).map(k => (
                          <div key={k} style={{ width: 36, display: 'flex', justifyContent: 'center' }}>
                            <ToggleBtn on={p[k]} onClick={() => setRolePerm(p.module, k)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowRoleForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={roleSaving || !roleForm.name.trim()} onClick={saveRole}>
                  {roleSaving ? 'Saving...' : editRoleId ? 'Save Changes' : 'Create Role'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };