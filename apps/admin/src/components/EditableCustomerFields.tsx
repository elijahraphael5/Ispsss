'use client';

import { useEffect, useState } from 'react';
import { api, formatNaira } from '@isp/shared';

const NETWORK_OPTIONS = [
  { value: 'RADIO', label: 'Radio' },
  { value: 'FIBER', label: 'Fiber' },
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
    networkType: customer.networkType ?? 'RADIO',
    plan: customer.plan ?? '',
    installerName: customer.cpes[0]?.installerName ?? '',
    dueAt: customer.dueAt ? new Date(customer.dueAt).toISOString().slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<Plan[]>('/subscriptions/plans').then(setPlans).catch(() => {});
  }, []);

  const filteredPlans = plans.filter(p => p.technology === draft.networkType);
  const hasCurrent = draft.plan && filteredPlans.some(p => p.name === draft.plan);
  const options = hasCurrent ? filteredPlans : [{ name: draft.plan || '', technology: draft.networkType, speedLabel: null, speedMbps: 0, priceKobo: 0 } as Plan, ...filteredPlans];

  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft(d => ({ ...d, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    setMsg('');
    try {
      const body: Record<string, string> = {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        address: draft.address,
        networkType: draft.networkType,
        planName: draft.plan,
        installerName: draft.installerName,
      };
      if (draft.dueAt) body.dueAt = draft.dueAt;
      const updated = await api<any>(`/users/customers/${customer.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved(updated);
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
            {NETWORK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </EditableField>
        <EditableField label="Plan">
          <select style={inputStyle} value={draft.plan} onChange={set('plan')}>
            {options.length === 0 && <option value="">—</option>}
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
