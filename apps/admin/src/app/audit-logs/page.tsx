'use client';

import { useState, useEffect } from 'react';
import { api } from '@isp/shared';
import { SkeletonBlock, SkeletonTable } from '../../components/Skeleton';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; email: string };
}

interface PaginatedResult {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

const actionColors: Record<string, { bg: string; fg: string }> = {
  INVOICE_CREATED: { bg: '#dbeafe', fg: '#1e40af' },
  INVOICE_ISSUED: { bg: '#fef9c3', fg: '#854d0e' },
  INVOICE_PAID: { bg: '#bbf7d0', fg: '#166534' },
  INVOICE_VOIDED: { bg: '#fecaca', fg: '#991b1b' },
  INVOICE_OVERDUE: { bg: '#fed7aa', fg: '#9a3412' },
  USER_CREATED: { bg: '#dbeafe', fg: '#1e40af' },
  USER_UPDATED: { bg: '#fef9c3', fg: '#854d0e' },
  USER_DELETED: { bg: '#fecaca', fg: '#991b1b' },
};

const btnStyle: React.CSSProperties = {
  padding: '9px 20px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
};

function formatJson(val: unknown): string {
  if (!val) return '—';
  const str = JSON.stringify(val, null, 1);
  return str.length > 120 ? str.slice(0, 120) + '…' : str;
}

function DiffView({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed = Array.from(allKeys).filter(k => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  if (changed.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No changes</span>;
  return (
    <div style={{ fontSize: '0.75rem', lineHeight: 1.6 }}>
      {changed.slice(0, 6).map(k => (
        <div key={k} style={{ marginBottom: 2 }}>
          <span style={{ fontWeight: 600, color: '#555' }}>{k}: </span>
          {before?.[k] !== undefined && <span style={{ color: '#DC2626', textDecoration: 'line-through', marginRight: 4 }}>{String(before[k])}</span>}
          {after?.[k] !== undefined && <span style={{ color: '#16A34A' }}>{String(after[k])}</span>}
        </div>
      ))}
      {changed.length > 6 && <span style={{ color: 'var(--text-muted)' }}>+{changed.length - 6} more</span>}
    </div>
  );
}

function canRollback(action: string, beforeData: unknown, afterData: unknown): boolean {
  if (action.endsWith('_CREATED')) return true;
  if (action.endsWith('_UPDATED') && beforeData) return true;
  if (action.endsWith('_DELETED') && afterData) return true;
  return false;
}

export default function AuditLogsPage() {
  const [result, setResult] = useState<PaginatedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function fetchLogs() {
    try {
      setError('');
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      if (entityTypeFilter) params.set('entityType', entityTypeFilter);
      if (actionFilter) params.set('action', actionFilter);
      const data = await api<PaginatedResult>(`/audit-logs?${params.toString()}`);
      setResult(data);
    } catch {
      setError('Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchLogs(); }, [page, entityTypeFilter, actionFilter]);

  async function handleRollback(logId: string, action: string) {
    if (!confirm(`Rollback "${action}"? This will revert the changes made by this action.`)) return;
    setRollingBack(logId);
    try {
      await api(`/audit-logs/${logId}/rollback`, { method: 'POST', body: JSON.stringify({}) });
      fetchLogs();
    } catch (e: any) {
      setError(e.message || 'Rollback failed');
    } finally {
      setRollingBack(null);
    }
  }

  const totalPages = result ? Math.ceil(result.total / result.limit) : 0;

  return (
    <main style={{ padding: 24 }}>
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #f87171', borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: '#991b1b', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>
      )}

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700 }}>Audit Logs</h1>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={entityTypeFilter} onChange={(e) => { setEntityTypeFilter(e.target.value); setPage(1); }}
              style={{ padding: '9px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.85rem', background: 'white', outline: 'none' }}>
              <option value="">All Entity Types</option>
              <option value="Invoice">Invoice</option>
              <option value="User">User</option>
              <option value="Ticket">Ticket</option>
              <option value="Subscriber">Subscriber</option>
              <option value="Plan">Plan</option>
              <option value="CustomRole">Custom Role</option>
              <option value="Cpe">CPE</option>
              <option value="Contract">Contract</option>
              <option value="Payment">Payment</option>
              <option value="NetworkDevice">Network Device</option>
            </select>
            <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              style={{ padding: '9px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.85rem', background: 'white', outline: 'none' }}>
              <option value="">All Actions</option>
              <option value="INVOICE_CREATED">INVOICE_CREATED</option>
              <option value="INVOICE_ISSUED">INVOICE_ISSUED</option>
              <option value="INVOICE_PAID">INVOICE_PAID</option>
              <option value="INVOICE_VOIDED">INVOICE_VOIDED</option>
              <option value="INVOICE_OVERDUE">INVOICE_OVERDUE</option>
              <option value="USER_CREATED">USER_CREATED</option>
              <option value="USER_UPDATED">USER_UPDATED</option>
              <option value="USER_DELETED">USER_DELETED</option>
              <option value="SUBSCRIBER_CREATED">SUBSCRIBER_CREATED</option>
              <option value="SUBSCRIBER_UPDATED">SUBSCRIBER_UPDATED</option>
              <option value="SUBSCRIBER_DELETED">SUBSCRIBER_DELETED</option>
              <option value="PLAN_CREATED">PLAN_CREATED</option>
              <option value="PLAN_UPDATED">PLAN_UPDATED</option>
              <option value="SUBSCRIPTION_CREATED">SUBSCRIPTION_CREATED</option>
              <option value="TICKET_CREATED">TICKET_CREATED</option>
              <option value="TICKET_UPDATED">TICKET_UPDATED</option>
            </select>
            <button onClick={fetchLogs} style={{ ...btnStyle, background: 'var(--primary)', color: '#fff' }}>Refresh</button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <SkeletonBlock width={120} height={34} borderRadius={20} />
              <SkeletonBlock width={140} height={34} borderRadius={20} />
            </div>
            <SkeletonTable rows={10} cols={6} />
          </div>
        ) : result && result.data.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: 16 }}>
            No audit logs found.
          </div>
        ) : result ? (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #eee' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Timestamp</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Actor</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Action</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Entity / ID</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Changes</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-muted)' }}>Rollback</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((log) => {
                    const ac = actionColors[log.action] ?? { bg: '#e5e7eb', fg: '#4b5563' };
                    const expanded = expandedId === log.id;
                    const canRb = canRollback(log.action, log.beforeData, log.afterData);
                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{new Date(log.createdAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 500, whiteSpace: 'nowrap' }}>{log.actor.email}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: ac.bg, color: ac.fg, whiteSpace: 'nowrap' }}>
                            {log.action}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{log.entityType}</div>
                          <code style={{ fontSize: '0.7rem', background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>{log.entityId.slice(0, 8)}…</code>
                        </td>
                        <td style={{ padding: '10px 12px', maxWidth: 300 }}>
                          {log.beforeData || log.afterData ? (
                            <>
                              <button onClick={() => setExpandedId(expanded ? null : log.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: 0 }}>
                                {expanded ? 'Hide diff' : 'View diff'}
                              </button>
                              {expanded && <DiffView before={log.beforeData} after={log.afterData} />}
                            </>
                          ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {canRb ? (
                            <button onClick={() => handleRollback(log.id, log.action)}
                              disabled={rollingBack === log.id}
                              style={{ padding: '5px 12px', borderRadius: 20, border: '1px solid #DC2626', background: rollingBack === log.id ? '#FEE2E2' : '#fff', color: '#DC2626', cursor: rollingBack === log.id ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                              {rollingBack === log.id ? '…' : 'Rollback'}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Page {result.page} of {totalPages} ({result.total} total)
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  style={{ ...btnStyle, padding: '8px 20px', background: page <= 1 ? '#e5e7eb' : 'var(--primary)', color: page <= 1 ? '#9ca3af' : '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
                  Previous
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  style={{ ...btnStyle, padding: '8px 20px', background: page >= totalPages ? '#e5e7eb' : 'var(--primary)', color: page >= totalPages ? '#9ca3af' : '#fff', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}