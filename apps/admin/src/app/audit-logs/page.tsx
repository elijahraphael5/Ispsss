'use client';

import { useState, useEffect } from 'react';
import { api } from '@isp/shared';
import { SkeletonTable } from '../../components/Skeleton';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; email: string } | null;
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

const pillSelect: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.8rem',
  background: '#fff', cursor: 'pointer', color: 'var(--text-dark)', outline: 'none',
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
    <>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Audit Logs</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {result ? `${result.total} entries` : 'Change history with rollback'}
          </p>
        </div>
        <button onClick={fetchLogs} className="btn-primary">
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 700, fontSize: '1rem' }}>×</button>
        </div>
      )}

      <div className="data-card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={entityTypeFilter} onChange={(e) => { setEntityTypeFilter(e.target.value); setPage(1); }} style={pillSelect}>
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
          <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} style={pillSelect}>
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
          {(entityTypeFilter || actionFilter) && (
            <button className="btn-sm-outline" onClick={() => { setEntityTypeFilter(''); setActionFilter(''); setPage(1); }}>Clear filters</button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 20 }}>
            <SkeletonTable rows={10} cols={6} />
          </div>
        ) : result && result.data.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
              <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>No audit logs found</span>
              <span style={{ fontSize: '0.78rem' }}>Try clearing the filters.</span>
            </div>
          </div>
        ) : result ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity / ID</th>
                    <th>Changes</th>
                    <th>Rollback</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((log) => {
                    const ac = actionColors[log.action] ?? { bg: '#F1F5F9', fg: '#475569' };
                    const expanded = expandedId === log.id;
                    const canRb = canRollback(log.action, log.beforeData, log.afterData);
                    return (
                      <tr key={log.id}>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {new Date(log.createdAt).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--text-dark)', whiteSpace: 'nowrap' }}>{log.actor?.email ?? 'deleted user'}</td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: ac.bg, color: ac.fg, whiteSpace: 'nowrap' }}>
                            {log.action}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-dark)', fontSize: '0.82rem' }}>{log.entityType}</div>
                          <code style={{ fontSize: '0.7rem', background: '#F1F5F9', padding: '2px 6px', borderRadius: 6, color: 'var(--text-muted)' }}>{log.entityId.slice(0, 8)}…</code>
                        </td>
                        <td style={{ maxWidth: 300 }}>
                          {log.beforeData || log.afterData ? (
                            <>
                              <button onClick={() => setExpandedId(expanded ? null : log.id)}
                                className="btn-sm-outline" style={{ padding: '4px 12px' }}>
                                {expanded ? 'Hide diff' : 'View diff'}
                              </button>
                              {expanded && <DiffView before={log.beforeData} after={log.afterData} />}
                            </>
                          ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>}
                        </td>
                        <td>
                          {canRb ? (
                            <button onClick={() => handleRollback(log.id, log.action)}
                              disabled={rollingBack === log.id}
                              className="btn-sm-outline"
                              style={{ padding: '5px 12px', color: '#DC2626', borderColor: '#FECACA', opacity: rollingBack === log.id ? 0.6 : 1, cursor: rollingBack === log.id ? 'not-allowed' : 'pointer' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderTop: '1px solid var(--border-color)', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Page {result.page} of {totalPages} · {result.total} entries
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="btn-sm-outline" style={{ padding: '6px 16px', opacity: page <= 1 ? 0.5 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>
                  Previous
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="btn-sm-outline" style={{ padding: '6px 16px', opacity: page >= totalPages ? 0.5 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>
                  Next
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}