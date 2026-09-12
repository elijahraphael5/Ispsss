'use client';

import { useEffect, useState } from 'react';
import { api, formatNaira } from '@isp/shared';

const NETWORK_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'RADIO', label: 'Radio' },
  { value: 'FIBER', label: 'Fiber' },
  { value: 'DIA', label: 'DIA' },
  { value: 'PPPOE', label: 'PPPoE' },
  { value: 'STATIC_IP', label: 'Static IP' },
];

interface Plan {
  id: string;
  name: string;
  technology: string;
  speedLabel: string | null;
  speedMbps: number;
  priceKobo: number;
}

export interface EditableCustomer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  networkType: string | null;
  plan: string | null;
  dueAt: string | null;
  cpes: { id: string; installerName: string | null }[];
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 12,
  border: '1px solid var(--border-color)', fontSize: '0.85rem', background: '#fff',
  color: 'var(--text-color)', outline: 'none',
};

function EditableField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

export default function EditableCustomerFields({ customer, onSaved }: { customer: EditableCustomer; onSaved: (updated: any) => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [draft, setDraft] = useState({
    name: customer.name ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    networkType: customer.networkType ?? '',
    plan: customer.plan ?? '',
    installerName: customer.cpes[0]?.installerName ?? '',
    dueAt: customer.dueAt ? new Date(customer.dueAt).toISOString().slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<Plan[]>('/subscriptions/plans').then(setPlans).catch(() => {});
  }, []);

  const filteredPlans = draft.networkType ? plans.filter(p => p.technology === draft.networkType) : plans;
  const hasCurrent = draft.plan && filteredPlans.some(p => p.name === draft.plan);
  const options = draft.plan
    ? hasCurrent ? filteredPlans : [{ name: draft.plan, technology: draft.networkType, speedLabel: null, speedMbps: 0, priceKobo: 0 } as Plan, ...filteredPlans]
    : filteredPlans;
  // Preserve a network type that isn't in the standard list (custom values from
  // imports) instead of silently flipping it on save.
  const networkOptions = NETWORK_OPTIONS.some(o => o.value === draft.networkType)
    ? NETWORK_OPTIONS
    : [{ value: draft.networkType, label: draft.networkType || '— None —' }, ...NETWORK_OPTIONS];

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft(d => ({ ...d, [k]: e.target.value }));

  async function save() {
    // Imported customers often have no real email (hidden '@lan' addresses):
    // allow saving as long as we're not wiping an existing login email.
    if (!draft.email.trim() && customer.email) {
      setMsg('Email cannot be empty — the customer needs it to sign in');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      const body: Record<string, string> = {
        name: draft.name,
        phone: draft.phone,
        address: draft.address,
        networkType: draft.networkType,
        planName: draft.plan,
        installerName: draft.installerName,
      };
      if (draft.email.trim()) body.email = draft.email;
      if (draft.dueAt) body.dueAt = draft.dueAt;
      const updated = await api<any>(`/users/customers/${customer.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      // Re-read the canonical record so the Details tab (and this form) show
      // exactly what was persisted, including derived fields (plan speed/price).
      const fresh = await api<any>(`/users/customers/${customer.id}`).catch(() => updated);
      onSaved(fresh);
      setDraft({
        name: fresh.name ?? '',
        email: fresh.email ?? '',
        phone: fresh.phone ?? '',
        address: fresh.address ?? '',
        networkType: fresh.networkType ?? '',
        plan: fresh.plan ?? '',
        installerName: fresh.cpes?.[0]?.installerName ?? '',
        dueAt: fresh.dueAt ? new Date(fresh.dueAt).toISOString().slice(0, 10) : '',
      });
      setMsg('Saved');
    } catch (e: any) {
      setMsg(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <EditableField label="Name"><input style={inputStyle} value={draft.name} onChange={set('name')} /></EditableField>
        <EditableField label="Email"><input style={inputStyle} value={draft.email} onChange={set('email')} /></EditableField>
        <EditableField label="Phone"><input style={inputStyle} value={draft.phone} onChange={set('phone')} /></EditableField>
        <EditableField label="Address"><input style={inputStyle} value={draft.address} onChange={set('address')} /></EditableField>
        <EditableField label="Network Type">
          <select style={inputStyle} value={draft.networkType} onChange={set('networkType')}>
            {networkOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </EditableField>
        <EditableField label="Plan">
          <select style={inputStyle} value={draft.plan} onChange={set('plan')}>
            {!draft.plan && <option value="">— No plan —</option>}
            {options.map(p => (
              <option key={p.name} value={p.name}>
                {p.name}{p.speedLabel ? ` · ${p.speedLabel}` : ''}{p.priceKobo ? ` · ${formatNaira(p.priceKobo)}` : ' · On request'}
              </option>
            ))}
          </select>
        </EditableField>
        <EditableField label="Installer Name"><input style={inputStyle} value={draft.installerName} onChange={set('installerName')} /></EditableField>
        <EditableField label="Payment Due Date"><input type="date" style={inputStyle} value={draft.dueAt} onChange={set('dueAt')} /></EditableField>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button onClick={save} disabled={saving} style={{
          padding: '8px 24px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff',
          fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        {msg && <span style={{ fontSize: '0.8rem', fontWeight: 600, color: msg === 'Saved' ? '#16A34A' : '#DC2626' }}>{msg}</span>}
      </div>
    </div>
  );
}
