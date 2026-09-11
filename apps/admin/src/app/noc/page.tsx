'use client';

import { useState } from 'react';
import NasTab from './NasTab';
import ProfilesTab from './ProfilesTab';

const TABS = ['NAS', 'Profiles'];

export default function NocPage() {
  const [tab, setTab] = useState('NAS');
  const [toastMsg, setToastMsg] = useState('');

  const toast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  return (
    <>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">NOC — RADIUS Configuration</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            FreeRADIUS clients and PPPoE profiles stored in SQL
          </p>
        </div>
      </div>

      <div className="badge-tabs" style={{ width: 'fit-content' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`tab-item${tab === t ? ' active' : ''}`}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}>
            {t}
          </button>
        ))}
      </div>

      {toastMsg && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 200, background: '#0F172A', color: '#fff', padding: '12px 20px', borderRadius: 12, fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {toastMsg}
        </div>
      )}

      {tab === 'NAS' && <NasTab toast={toast} />}
      {tab === 'Profiles' && <ProfilesTab toast={toast} />}
    </>
  );
}
