'use client';

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to customer-data change notifications (edits, KYC approvals,
 * purge). Pages that render customer data should reload when notified —
 * Next's router cache can otherwise serve stale rows after navigating back.
 */
export function onCustomersChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Call after any mutation that changes customer data. */
export function notifyCustomersChanged(): void {
  listeners.forEach(fn => fn());
}
