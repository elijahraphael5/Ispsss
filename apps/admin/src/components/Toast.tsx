'use client';

import { useEffect, Dispatch, SetStateAction } from 'react';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
}

let nextId = 0;

export function useToast() {
  function toast(message: string, type: 'success' | 'error' = 'error', toasts: ToastItem[], setToasts: Dispatch<SetStateAction<ToastItem[]>>) {
    const id = ++nextId;
    setToasts([...toasts, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }
  return { toast };
}

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '12px 20px', borderRadius: 12, fontSize: '0.85rem', fontWeight: 500,
          color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          backgroundColor: t.type === 'success' ? '#16A34A' : '#DC2626',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
