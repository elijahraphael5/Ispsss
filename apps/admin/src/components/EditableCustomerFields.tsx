'use client';

import { useEffect, useState } from 'react';
import { api, formatNaira } from '@isp/shared';

const NETWORK_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'RADIO', label: 'Radio (sheet: RADIO)' },
  { value: 'FIBER', label: 'Fiber' },
  { value: 'FIBER HOTSPOT', label: 'Fiber Hotspot (sheet)' },
  { value: 'FIBER PPPOE', label: 'Fiber PPPoE (sheet)' },
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
  secondaryPhone?: string | null;
  address: string | null;
  networkType: string | null;
  plan: string | null;
  dueAt: string | null;
  staticIpAddress?: string | null;
  legacyId?: string | null;
  id2?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  stationLabel?: string | null;
  cpes: { id: string; ipAddress: string | null; installerName: string | null }[];
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
    secondaryPhone: (customer as any).secondaryPhone ?? '',
    address: customer.address ?? '',
    networkType: customer.networkType ?? '',
    plan: customer.plan ?? '',
    installerName: customer.cpes[0]?.installerName ?? '',
    dueAt: customer.dueAt ? new Date(customer.dueAt).toISOString().slice(0, 10) : '',
    ipAddress: (customer as any).staticIpAddress ?? customer.cpes[0]?.ipAddress ?? '',
    // 16 sheet columns
    legacyId: (customer as any).legacyId ?? '',
    id2: (customer as any).id2 ?? '',
    firstName: (customer as any).firstName ?? '',
    lastName: (customer as any).lastName ?? '',
    companyName: (customer as any).companyName ?? '',
    stationLabel: (customer as any).stationLabel ?? '',
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
    if (draft.ipAddress && !/^(\d{1,3}\.){3}\d{1,3}$/.test(draft.ipAddress.trim())) {
      setMsg('Invalid IP address');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      // For static IP with duplicate (subscriber.staticIp null, CPE has duplicate), saving without IP change would try to set subscriber IP to duplicate and 409.
      // Only send IP if it actually changed from the original (staticIp or CPE).
      const origIp = String((customer as any).staticIpAddress ?? customer.cpes[0]?.ipAddress ?? '').trim();
      const newIp = draft.ipAddress.trim();
      const body: Record<string, string> = {
        name: draft.name,
        phone: draft.phone,
        secondaryPhone: draft.secondaryPhone,
        address: draft.address,
        networkType: draft.networkType,
        planName: draft.plan,
        installerName: draft.installerName,
        legacyId: draft.legacyId.trim(),
        id2: draft.id2.trim(),
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        companyName: draft.companyName.trim(),
        stationLabel: draft.stationLabel.trim(),
      };
      if (newIp !== origIp) body.ipAddress = newIp;
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
        secondaryPhone: (fresh as any).secondaryPhone ?? '',
        address: fresh.address ?? '',
        networkType: fresh.networkType ?? '',
        plan: fresh.plan ?? '',
        installerName: fresh.cpes?.[0]?.installerName ?? '',
        dueAt: fresh.dueAt ? new Date(fresh.dueAt).toISOString().slice(0, 10) : '',
        ipAddress: (fresh as any).staticIpAddress ?? fresh.cpes?.[0]?.ipAddress ?? '',
        legacyId: (fresh as any).legacyId ?? '',
        id2: (fresh as any).id2 ?? '',
        firstName: (fresh as any).firstName ?? '',
        lastName: (fresh as any).lastName ?? '',
        companyName: (fresh as any).companyName ?? '',
        stationLabel: (fresh as any).stationLabel ?? '',
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
        <EditableField label="ID (legacy)"><input style={inputStyle} value={draft.legacyId} onChange={set('legacyId')} placeholder="HIF/HIR" /></EditableField>
        <EditableField label="ID2"><input style={inputStyle} value={draft.id2} onChange={set('id2')} /></EditableField>
        <EditableField label="FIRST NAME"><input style={inputStyle} value={draft.firstName} onChange={set('firstName')} /></EditableField>
        <EditableField label="LAST NAME"><input style={inputStyle} value={draft.lastName} onChange={set('lastName')} /></EditableField>
        <EditableField label="COMPANY NAME"><input style={inputStyle} value={draft.companyName} onChange={set('companyName')} /></EditableField>
        <EditableField label="Name (display)"><input style={inputStyle} value={draft.name} onChange={set('name')} /></EditableField>
        <EditableField label="Email"><input style={inputStyle} value={draft.email} onChange={set('email')} /></EditableField>
        <EditableField label="CONTACT NUMBER"><input style={inputStyle} value={draft.phone} onChange={set('phone')} placeholder="080..." /></EditableField>
        <EditableField label="Secondary Contact"><input style={inputStyle} value={draft.secondaryPhone} onChange={set('secondaryPhone')} placeholder="070... (optional)" /></EditableField>
        <EditableField label="STATION"><input style={inputStyle} value={draft.stationLabel} onChange={set('stationLabel')} placeholder="HOME / FIBER / RADIO" /></EditableField>
        <EditableField label="Address"><input style={inputStyle} value={draft.address} onChange={set('address')} /></EditableField>
        <EditableField label="USER TYPE / Network Type">
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
        <EditableField label="IP ADDRESS"><input style={inputStyle} value={draft.ipAddress} onChange={set('ipAddress')} placeholder="e.g. 192.168.1.10" /></EditableField>
        <EditableField label="Payment Due Date (EXPIRY)"><input type="date" style={inputStyle} value={draft.dueAt} onChange={set('dueAt')} /></EditableField>
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
