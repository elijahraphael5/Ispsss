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
        <h1 className="page-title">NOC — RADIUS Configuration</h1>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
            backgroundColor: tab === t ? 'var(--primary)' : '#fff', color: tab === t ? '#fff' : 'var(--text-color)',
          }}>{t}</button>
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
