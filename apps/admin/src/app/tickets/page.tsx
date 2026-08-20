'use client';

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, apiUpload, apiFileUrl, useAuthStore, timeAgo, formatNaira } from '@isp/shared';
import { useToast, ToastContainer } from '../../components/Toast';

// ─────────────────────────── types ───────────────────────────

interface ChatAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  senderId: string | null;
  senderName: string | null;
  senderType: 'CUSTOMER' | 'AGENT';
  body: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  attachments?: ChatAttachment[];
}

interface SessionRow {
  id: string;
  customerName: string | null;
  customerEmail: string;
  status: string;
  department: string | null;
  agentId: string | null;
  csat: number | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lastMessage: { body: string; senderType: string; createdAt: string } | null;
  unreadCount: number;
}

interface SessionDetail {
  id: string;
  customerName: string | null;
  customerEmail: string;
  status: string;
  department: string | null;
  agentId: string | null;
  csat: number | null;
  createdAt: string;
  closedAt: string | null;
  messages: ChatMessage[];
  agent: { id: string; email: string } | null;
  tickets: { id: string; subject: string; status: string }[];
  subscriber: {
    id: string;
    status: string;
    address: string | null;
    user: { id: string; email: string; phone: string | null };
    subscriptions: { plan: { name: string; speedMbps: number | null; priceKobo: number; technology: string | null; staticIp: boolean } }[];
    devices: { id: string; name: string; macAddress: string | null; ipAddress: string | null; status: string; connectionType: string }[];
    invoices: { id: string; invoiceNumber: string; status: string; amountKobo: number; dueAt: Date | null; paidAt: Date | null }[];
  } | null;
}

interface Agent {
  id: string;
  email: string;
  name: string;
  role: string | null;
  presence: string;
  lastSeenAt: string | null;
}

interface Canned {
  id: string;
  title: string;
  body: string;
  category: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  description: string | null;
  category: string | null;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  subscriber: { id: string; user: { id: string; email: string; phone: string | null } } | null;
  assignedAgent: { id: string; email: string } | null;
  _count: { comments: number };
}

interface TicketDetail {
  id: string;
  subject: string;
  status: string;
  priority: string;
  description: string | null;
  category: string | null;
  slaDueAt: string | null;
  createdAt: string;
  subscriber: {
    id: string;
    status: string;
    user: { id: string; email: string; phone: string | null };
    subscriptions: { plan: { name: string; speedMbps: number | null } }[];
  } | null;
  assignedAgent: { id: string; email: string } | null;
  sourceChatSession: { id: string; status: string; customerName: string | null; customerEmail: string } | null;
  comments: {
    id: string;
    author: string;
    authorType: string;
    body: string;
    internal: boolean;
    createdAt: string;
    attachments?: ChatAttachment[];
  }[];
}

interface CustomerOption {
  id: string;
  status: string;
  user: { id: string; email: string; phone: string | null };
  subscriptions: { plan: { name: string } }[];
}

interface PerfRow {
  agentId: string;
  name: string;
  email: string;
  role: string | null;
  presence: string;
  chatsHandled: number;
  closedChats: number;
  resolutionRate: number;
  avgFirstResponseSec: number;
  avgDurationSec: number;
  avgCsat: number;
  ratedChats: number;
  ticketsResolved: number;
}

interface PerfData {
  range: string;
  since: string;
  totals: { chatsHandled: number; closedChats: number; ticketsResolved: number; avgCsat: number };
  agents: PerfRow[];
}

// ─────────────────────────── helpers ───────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const SOCKET_URL = API_BASE.replace('/api/v1', '');

const statusColors: Record<string, { bg: string; fg: string }> = {
  OPEN: { bg: '#dbeafe', fg: '#1e40af' },
  IN_PROGRESS: { bg: '#fef3c7', fg: '#92400e' },
  ESCALATED: { bg: '#fee2e2', fg: '#991b1b' },
  RESOLVED: { bg: '#d1fae5', fg: '#065f46' },
  CLOSED: { bg: '#e5e7eb', fg: '#4b5563' },
};

const priorityColors: Record<string, { bg: string; fg: string }> = {
  LOW: { bg: '#e5e7eb', fg: '#4b5563' },
  MEDIUM: { bg: '#dbeafe', fg: '#1e40af' },
  HIGH: { bg: '#fef3c7', fg: '#92400e' },
  URGENT: { bg: '#fee2e2', fg: '#991b1b' },
};

const chatStatusColors: Record<string, string> = { WAITING: '#CA8A04', ACTIVE: '#16A34A', CLOSED: '#94A3B8' };

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtKobo(k: number) {
  return k ? formatNaira(k) : 'On request';
}

function fmtDur(sec: number) {
  if (sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function Pill({ status, map }: { status: string; map: Record<string, { bg: string; fg: string }> }) {
  const c = map[status] ?? { bg: '#e5e7eb', fg: '#4b5563' };
  return <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem', background: c.bg, color: c.fg }}>{status}</span>;
}

function Star({ filled }: { filled: boolean }) {
  return <span style={{ color: filled ? '#F59E0B' : '#d1d5db', fontSize: '1.1rem' }}>★</span>;
}

function TickIcon({ status }: { status: string }) {
  const color = status === 'READ' ? '#3b82f6' : '#94a3b8';
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 4, verticalAlign: 'middle' }}><path d="M2 7.5l2.5 3 4-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 7.5l2.5 3 4-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function PaperclipIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-color)',
  fontSize: '0.85rem', outline: 'none', background: '#fff', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 5, fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' };

// ─────────────────────────── page ───────────────────────────

type HubTab = 'chat' | 'tickets' | 'canned' | 'analytics';

export default function SupportHub() {
  const { user, accessToken } = useAuthStore();
  const { toast } = useToast();
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);

  const [tab, setTab] = useState<HubTab>('chat');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);

  return (
    <>
      <ToastContainer toasts={toasts} />
      <div className="page-title-row" style={{ marginBottom: 20 }}>
        <h1 className="page-title">Support</h1>
      </div>

      <div className="badge-tabs" style={{ marginBottom: 20, width: 'fit-content' }}>
        {(['chat', 'tickets', 'canned', 'analytics'] as HubTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`tab-item ${tab === t ? 'active' : ''}`}
            style={{ border: 'none', background: 'transparent', fontWeight: 600, textTransform: 'capitalize', fontSize: '0.82rem' }}>
            {t === 'chat' ? 'Live Chat' : t === 'canned' ? 'Canned Replies' : t === 'analytics' ? 'Performance' : 'Tickets'}
          </button>
        ))}
      </div>

{tab === 'chat' && <ChatTab user={user} accessToken={accessToken} agents={agents} setAgents={setAgents} agentsOnline={agentsOnline} setAgentsOnline={setAgentsOnline} socket={socket} setSocket={setSocket} toast={toast} toasts={toasts} setToasts={setToasts} />}
      {tab === 'tickets' && <TicketsTab toast={toast} toasts={toasts} setToasts={setToasts} />}
      {tab === 'canned' && <CannedTab toast={toast} toasts={toasts} setToasts={setToasts} />}
      {tab === 'analytics' && <AnalyticsTab />}
    </>
  );
}

// ─────────────────────────── LIVE CHAT ───────────────────────────

function ChatTab({ user, accessToken, agents, setAgents, agentsOnline, setAgentsOnline, socket, setSocket, toast, toasts, setToasts }: {
  user: any;
  accessToken: string | null;
  agents: Agent[];
  setAgents: (a: Agent[]) => void;
  agentsOnline: number;
  setAgentsOnline: (n: number | ((p: number) => number)) => void;
  socket: Socket | null;
  setSocket: (s: Socket | null) => void;
  toast: (m: string, t: 'success' | 'error', toasts: any[], set: any) => void;
  toasts: { id: number; message: string; type: 'success' | 'error' }[];
  setToasts: (t: any[]) => void;
}) {
  const [scope, setScope] = useState<'queue' | 'assigned' | 'closed'>('queue');
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState('');
  const [pendingFiles, setPendingFiles] = useState<{ id: string; fileName: string; sizeBytes: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [canned, setCanned] = useState<Canned[]>([]);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertSubject, setConvertSubject] = useState('');
  const [typing, setTyping] = useState<{ sessionId: string; userId: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  const refreshRows = useCallback(async (sc: string = scope) => {
    try {
      const data = await api<SessionRow[]>(`/support/sessions?scope=${sc}`);
      setRows(data);
    } catch { /* swallow */ }
    finally { setLoading(false); }
  }, [scope]);

  const refreshRowsRef = useRef(refreshRows);
  refreshRowsRef.current = refreshRows;

  useEffect(() => { refreshRows(); }, [refreshRows]);

  useEffect(() => {
    const iv = setInterval(() => refreshRowsRef.current(), 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!accessToken || !user) return;
    setAgentsOnline(0);
    const s = io(`${SOCKET_URL}/chat`, { auth: { token: accessToken }, query: { role: 'agent', userId: user.id } });
    setSocket(s);

    s.on('connect', () => { s.emit('chat:getAgents'); refreshRowsRef.current(); });
    s.on('agent:count', (n: number) => setAgentsOnline(n));
    s.on('agent:online', () => setAgentsOnline(n => n + 1));
    s.on('agent:offline', () => setAgentsOnline(n => Math.max(0, n - 1)));

    s.on('chat:new', () => { if (scope !== 'closed') refreshRowsRef.current(); });
    s.on('chat:changed', () => { if (scope !== 'closed') refreshRowsRef.current(); });
    s.on('chat:activity', () => { refreshRowsRef.current(); });

    s.on('chat:message', (msg: ChatMessage) => {
      setSession(prev => prev?.id === msg.sessionId ? { ...prev, messages: [...(prev?.messages ?? []).filter(m => m.id !== msg.id), msg] } : prev);
      refreshRowsRef.current();
    });

    s.on('chat:typing', (d: { sessionId: string; userId: string; isTyping: boolean }) => {
      if (d.sessionId === sessionIdRef.current) setTyping(d.isTyping ? d : null);
    });

    s.on('chat:assigned', (d: { sessionId: string; agentId: string }) => {
      refreshRowsRef.current();
      setSession(prev => prev && prev.agentId === null && prev.id === d.sessionId ? { ...prev, agentId: d.agentId, agent: { id: d.agentId, email: '' } } : prev);
    });
    s.on('chat:error', (e: { message: string }) => toast(e.message || 'Socket error', 'error', toasts, setToasts));

    api<Agent[]>('/support/agents').then(setAgents).catch(() => {});
    return () => { s.disconnect(); setSocket(null); };
  }, [accessToken, user?.id]);

  useEffect(() => {
    if (!accessToken || !user) return;
    api<Canned[]>('/support/canned').then(setCanned).catch(() => {});
    api<Agent[]>('/support/agents').then(setAgents).catch(() => {});
  }, [accessToken, user]);

  useEffect(() => {
    const el = endRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages]);

  async function openSession(row: SessionRow) {
    socket?.emit('chat:join', row.id);
    sessionIdRef.current = row.id;
    try {
      const full = await api<SessionDetail>(`/support/sessions/${row.id}`);
      setSession(full);
      socket?.emit('chat:read', row.id);
      refreshRowsRef.current();
    } catch {
      toast('Failed to open session', 'error', toasts, setToasts);
    }
  }

  async function closeCurrent() {
    if (!session) return;
    try {
      const s = await api<SessionDetail>(`/support/sessions/${session.id}/close`, { method: 'PATCH' });
      setSession(prev => prev ? { ...prev, status: 'CLOSED', closedAt: s.closedAt ?? new Date().toISOString() } : prev);
      refreshRows();
      toast('Chat closed', 'success', toasts, setToasts);
    } catch { toast('Failed to close chat', 'error', toasts, setToasts); }
  }

  async function sendMessage() {
    const body = composer.trim();
    if ((!body && pendingFiles.length === 0) || !session) return;
    socket?.emit('chat:message', { sessionId: session.id, body, attachmentIds: pendingFiles.map(f => f.id) });
    socket?.emit('chat:typing', { sessionId: session.id, isTyping: false });
    setComposer('');
    setPendingFiles([]);
  }

  async function attachFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !session) return;
    try {
      const up = await apiUpload<{ id: string; fileName: string; sizeBytes: number }>(`/chat/sessions/${session.id}/attachments`, file);
      setPendingFiles(f => [...f, { id: up.id, fileName: up.fileName, sizeBytes: up.sizeBytes }]);
    } catch (err: any) {
      toast(err.message || 'Upload failed', 'error', toasts, setToasts);
    }
  }

  function openFile(upload: { id: string; fileName: string }) {
    apiFileUrl(upload.id).then(url => window.open(url, '_blank')).catch(() => {});
  }

  const transferTargets = agents.filter(a => a.id !== session?.agentId && a.presence !== 'OFFLINE');

  async function transferTo(agentId: string) {
    if (!session) return;
    try {
      const s = await api<SessionDetail>(`/support/sessions/${session.id}/reassign`, { method: 'POST', body: JSON.stringify({ agentId }) });
      setSession(prev => prev ? { ...prev, agentId: s.agentId } : prev);
      toast('Chat transferred', 'success', toasts, setToasts);
    } catch (e: any) { toast(e.message || 'Transfer failed', 'error', toasts, setToasts); }
  }

  async function convertToTicket() {
    if (!session || !convertSubject.trim()) return;
    try {
      const t = await api<Ticket>(`/support/sessions/${session.id}/convert-ticket`, { method: 'POST', body: JSON.stringify({ subject: convertSubject.trim() }) });
      setConvertOpen(false);
      setConvertSubject('');
      toast(`Ticket #${t.id.slice(0, 8)} created`, 'success', toasts, setToasts);
      refreshRows();
    } catch (e: any) { toast(e.message || 'Failed to create ticket', 'error', toasts, setToasts); }
  }

  const waitingCount = rows.filter(r => r.status === 'WAITING' && !r.agentId).length;
  const mineCount = rows.filter(r => r.agentId === user?.id).length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 300px', gap: 16, height: 'calc(100vh - 190px)', minHeight: 480 }}>
      {/* session list */}
      <div className="data-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 6, alignItems: 'center' }}>
          {(['queue', 'assigned', 'closed'] as const).map(s => (
            <button key={s} onClick={() => setScope(s)}
              style={{ padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', background: scope === s ? 'var(--primary)' : 'var(--primary-light)', color: scope === s ? '#fff' : 'var(--primary)' }}>
              {s === 'queue' ? `Queue (${waitingCount})` : s === 'assigned' ? `Mine (${mineCount})` : 'Closed'}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{agentsOnline} online</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? <p style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
            : rows.length === 0 ? <p style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: '0.85rem' }}>No {scope} sessions</p>
            : rows.map(r => (
              <div key={r.id} onClick={() => openSession(r)}
                style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', background: session?.id === r.id ? 'var(--primary-light)' : 'transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.customerName || r.customerEmail.split('@')[0]}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.unreadCount > 0 && <span style={{ background: '#DC2626', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700 }}>{r.unreadCount}</span>}
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: chatStatusColors[r.status] ?? '#94A3B8' }} />
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.lastMessage ? `${r.lastMessage.senderType === 'AGENT' ? 'You:' : ''} ${r.lastMessage.body}` : '(no messages)'}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {timeAgo(r.updatedAt)}{r.agentId && r.agentId !== user?.id ? ' · ' + (agents.find(a => a.id === r.agentId)?.name ?? 'other') : ''}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* thread */}
      <div className="data-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!session ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Select a session from the left
          </div>
        ) : (
          <>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                  {session.customerName || session.customerEmail.split('@')[0] || 'Customer'}
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: chatStatusColors[session.status], display: 'inline-block', marginLeft: 8, verticalAlign: 'middle' }} />
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{session.customerEmail} · started {timeAgo(session.createdAt)}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={session.agentId ?? ''} onChange={e => e.target.value && transferTo(e.target.value)} style={{ ...inputStyle, width: 130, padding: '6px 10px', fontSize: '0.75rem' }}>
                  <option value="">{session.agentId ? 'Assigned' : 'Unassigned'}</option>
                  {transferTargets.map(a => <option key={a.id} value={a.id}>{a.name}{a.presence === 'ONLINE' ? ' ●' : ''}</option>)}
                </select>
                <button onClick={() => setConvertOpen(true)} className="btn-sm-outline">Convert to Ticket</button>
                <button onClick={closeCurrent} className="btn-sm-outline" style={{ color: session.status === 'CLOSED' ? 'var(--text-muted)' : '#DC2626', borderColor: '#FECACA' }}>
                  {session.status === 'CLOSED' ? 'Closed' : 'End Chat'}
                </button>
              </div>
            </div>

            <div ref={endRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {session.messages.map(m => {
                const mine = m.senderType === 'AGENT';
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '72%' }}>
                      <div style={{
                        padding: '9px 14px', borderRadius: 16, fontSize: '0.85rem', lineHeight: 1.45,
                        background: mine ? 'var(--primary)' : '#F1F5F9', color: mine ? '#fff' : 'var(--text-dark)',
                        borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4,
                      }}>
                        {m.body}
                        {m.attachments?.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: m.body ? 8 : 0 }}>
                            {m.attachments.map(a => (
                              <div key={a.id} onClick={() => openFile(a)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.75rem', background: 'rgba(255,255,255,0.18)', borderRadius: 8, padding: '5px 9px', textDecoration: 'underline' }}>
                                <PaperclipIcon /> <span style={{ fontWeight: 600 }}>{a.fileName}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        {fmtTime(m.createdAt)}
                        {mine && <TickIcon status={m.status} />}
                      </div>
                    </div>
                  </div>
                );
              })}
              {typing && typing.sessionId === session.id && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Typing…</div>
              )}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <textarea
                  value={composer}
                  onChange={e => {
                    setComposer(e.target.value);
                    if (socket?.connected) socket.emit('chat:typing', { sessionId: session.id, isTyping: e.target.value.length > 0 });
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Type a message…"
                  rows={2}
                  style={{ ...inputStyle, resize: 'none', flex: 1, maxHeight: 90 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={() => setCannedOpen(o => !o)} className="btn-sm-outline">Canned</button>
                  <button onClick={() => fileInputRef.current?.click()} className="btn-sm-outline" title="Attach a file">Attach</button>
                  <button onClick={sendMessage} disabled={!composer.trim() && pendingFiles.length === 0} className="btn-sm" style={{ minWidth: 60 }}>Send</button>
                </div>
              </div>
              {pendingFiles.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {pendingFiles.map(f => (
                    <span key={f.id} style={{ background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 12, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PaperclipIcon /> {f.fileName}
                      <button onClick={() => setPendingFiles(files => files.filter(x => x.id !== f.id))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input ref={fileInputRef} type="file" hidden onChange={attachFile} />
              {cannedOpen && (
                <div style={{ marginTop: 10, border: '1px solid var(--border-color)', borderRadius: 12, maxHeight: 180, overflowY: 'auto', background: '#FAFAFA' }}>
                  <div style={{ padding: '8px 12px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Canned responses</div>
                  {canned.length === 0 && <p style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>None yet</p>}
                  {canned.map(c => (
                    <button key={c.id}
                      onClick={() => { setComposer(prev => prev ? prev + ' ' : '' + c.body + '\n'); setCannedOpen(false); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', borderTop: '1px solid var(--border-color)', fontSize: '0.82rem' }}>
                      <strong>{c.title}</strong>
                      <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 2 }}>{c.body.slice(0, 90)}{c.body.length > 90 ? '…' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* context panel */}
      <div className="data-card" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {!session ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: 20 }}>Customer context appears here</p>
        ) : (
          <>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Customer Context</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{session.customerEmail}</div>
            </div>
            {session.subscriber ? (
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={labelStyle}>Subscription</div>
                  {session.subscriber.subscriptions[0] ? (
                    <>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{session.subscriber.subscriptions[0].plan.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{session.subscriber.subscriptions[0].plan.speedMbps} Mbps · {fmtKobo(session.subscriber.subscriptions[0].plan.priceKobo)}/mo</div>
                    </>
                  ) : <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No active plan</div>}
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                    Status: <b style={{ color: session.subscriber.status === 'ACTIVE' ? '#16A34A' : '#DC2626' }}>{session.subscriber.status}</b>
                  </div>
                  {session.subscriber.address && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>📍 {session.subscriber.address}</div>}
                </div>

                <div>
                  <div style={labelStyle}>Devices ({session.subscriber.devices.length})</div>
                  {session.subscriber.devices.length === 0
                    ? <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>None registered</div>
                    : session.subscriber.devices.map(d => (
                      <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
                        <span style={{ fontWeight: 600 }}>{d.name || d.connectionType}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{d.ipAddress || d.macAddress || d.status}</span>
                      </div>
                    ))}
                </div>

                <div>
                  <div style={labelStyle}>Recent invoices</div>
                  {session.subscriber.invoices.length === 0
                    ? <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>None</div>
                    : session.subscriber.invoices.map(i => (
                      <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
                        <span>{i.invoiceNumber}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{fmtKobo(i.amountKobo)}</span>
                      </div>
                    ))}
                </div>

                <div>
                  <div style={labelStyle}>Related Tickets</div>
                  {session.tickets.length === 0
                    ? <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>None</div>
                    : session.tickets.map(t => (
                      <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{t.subject}</span>
                        <Pill status={t.status} map={statusColors} />
                      </div>
                    ))}
                </div>

                {session.csat !== null && (
                  <div>
                    <div style={labelStyle}>Chat rating</div>
                    <div>{[1, 2, 3, 4, 5].map(n => <Star key={n} filled={n <= session.csat!} />)}</div>
                  </div>
                )}
              </div>
            ) : (
              <p style={{ padding: '16px 18px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No linked subscriber account</p>
            )}
          </>
        )}
      </div>

      {/* convert-to-ticket modal */}
      {convertOpen && session && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setConvertOpen(false)}>
          <div className="data-card" style={{ width: 440, padding: 24 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>Convert chat to ticket</h3>
            <label style={labelStyle}>Subject</label>
            <input value={convertSubject} onChange={e => setConvertSubject(e.target.value)} placeholder={`Chat: ${session.customerName || 'Support request'}`} style={{ ...inputStyle, marginBottom: 16 }} autoFocus />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConvertOpen(false)} className="btn-outline">Cancel</button>
              <button onClick={convertToTicket} disabled={!convertSubject.trim()} className="btn-primary">Create Ticket</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── TICKETS ───────────────────────────

function TicketsTab({ toast, toasts, setToasts }: { toast: any; toasts: any[]; setToasts: (a: any[]) => void }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cusSearch, setCusSearch] = useState('');
  const [cusResults, setCusResults] = useState<CustomerOption[]>([]);
  const [form, setForm] = useState({ subscriberId: '', subject: '', category: 'GENERAL', priority: 'MEDIUM', description: '' });
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [ticketFiles, setTicketFiles] = useState<{ id: string; fileName: string; sizeBytes: number }[]>([]);
  const ticketFileRef = useRef<HTMLInputElement>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => { load(); api<Agent[]>('/support/agents').then(setAgents).catch(() => {}); }, []);
  useEffect(() => { if (detailId) api<TicketDetail>(`/support/tickets/${detailId}`).then(setDetail).catch(() => setDetailId(null)); }, [detailId]);

  async function load() {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (status) q.set('status', status);
      if (priority) q.set('priority', priority);
      if (search) q.set('search', search);
      const data = await api<Ticket[]>(`/support/tickets${q.toString() ? '?' + q.toString() : ''}`);
      setTickets(data);
    } catch {} finally { setLoading(false); }
  }

  function pill(s: string, m: Record<string, { bg: string; fg: string }>) {
    const c = m[s] ?? { bg: '#e5e7eb', fg: '#4b5563' };
    return <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem', background: c.bg, color: c.fg }}>{s}</span>;
  }

  async function searchCustomers(q: string) {
    try {
      const data = await api<CustomerOption[]>(`/support/customers?search=${encodeURIComponent(q)}`);
      setCusResults(data);
    } catch {}
  }

  async function createTicket() {
    if (!form.subscriberId) { toast('Select a customer', 'error', toasts, setToasts); return; }
    if (!form.subject.trim()) { toast('Enter a subject', 'error', toasts, setToasts); return; }
    try {
      await api('/support/tickets', { method: 'POST', body: JSON.stringify(form) });
      setCreateOpen(false);
      setForm({ subscriberId: '', subject: '', category: 'GENERAL', priority: 'MEDIUM', description: '' });
      toast('Ticket created', 'success', toasts, setToasts);
      load();
    } catch (e: any) { toast(e.message || 'Failed to create ticket', 'error', toasts, setToasts); }
  }

  async function patchTicket(patch: Record<string, any>) {
    if (!detailId) return;
    try {
      await api(`/support/tickets/${detailId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setDetail(await api<TicketDetail>(`/support/tickets/${detailId}`));
      load();
      toast('Ticket updated', 'success', toasts, setToasts);
    } catch (e: any) { toast(e.message || 'Update failed', 'error', toasts, setToasts); }
  }

  async function addCommentBody() {
    if ((!comment.trim() && ticketFiles.length === 0) || !detailId) return;
    try {
      await api(`/support/tickets/${detailId}/comments`, { method: 'POST', body: JSON.stringify({ body: comment.trim(), internal, attachmentIds: ticketFiles.map(f => f.id) }) });
      setComment('');
      setInternal(false);
      setTicketFiles([]);
      setDetail(await api<TicketDetail>(`/support/tickets/${detailId}`));
    } catch (e: any) { toast(e.message || 'Failed to comment', 'error', toasts, setToasts); }
  }

  async function uploadTicketFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !detailId) return;
    try {
      const up = await apiUpload<{ id: string; fileName: string; sizeBytes: number }>(`/support/tickets/${detailId}/attachments`, file);
      setTicketFiles(f => [...f, { id: up.id, fileName: up.fileName, sizeBytes: up.sizeBytes }]);
    } catch (err: any) { toast(err.message || 'Upload failed', 'error', toasts, setToasts); }
  }

  return (
    <>
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={status} onChange={e => { setStatus(e.target.value); setTimeout(load, 0); }} style={inputStyle} className="sel">
            <option value="">All statuses</option>
            {Object.keys(statusColors).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={priority} onChange={e => { setPriority(e.target.value); setTimeout(load, 0); }} style={{ ...inputStyle, width: 140 }}>
            <option value="">All priorities</option>
            {Object.keys(priorityColors).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="search-box" style={{ width: 220 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder="Search subject / email" />
          </div>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">+ New Ticket</button>
      </div>

      <div className="data-card">
        {loading ? <p style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</p>
          : tickets.length === 0 ? <p style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No tickets</p>
          : <div className="table-scroll">
              <table>
                <thead><tr><th>Subject</th><th>Status</th><th>Priority</th><th>Customer</th><th>Assigned</th><th>Comments</th><th>Updated</th></tr></thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.id} onClick={() => setDetailId(t.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{t.subject}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{t.category}</div></td>
                      <td>{pill(t.status, statusColors)}</td>
                      <td>{pill(t.priority, priorityColors)}</td>
                      <td>{t.subscriber?.user.email ?? '—'}</td>
                      <td>{t.assignedAgent?.email.split('@')[0] ?? '—'}</td>
                      <td>{t._count.comments}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{timeAgo(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </div>

      {detailId && detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 900 }} onClick={() => setDetailId(null)}>
          <div className="data-card" style={{ width: 560, height: '100%', display: 'flex', flexDirection: 'column', borderRadius: '24px 0 0 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{detail.subject}</h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {detail.subscriber?.user.email}{detail.subscriber?.user.phone ? ' · ' + detail.subscriber?.user.phone : ''} · opened {timeAgo(detail.createdAt)}
                  </div>
                  {detail.sourceChatSession && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>From chat session · {detail.sourceChatSession.status}</div>}
                </div>
                <button onClick={() => setDetailId(null)} className="btn-sm-outline">✕</button>
              </div>
              {detail.description && <p style={{ margin: '10px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{detail.description}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={detail.status} onChange={e => patchTicket({ status: e.target.value })} style={{ ...inputStyle, width: 140, fontSize: '0.78rem' }}>
                  {Object.keys(statusColors).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <select value={detail.priority} onChange={e => patchTicket({ priority: e.target.value })} style={{ ...inputStyle, width: 110, fontSize: '0.78rem' }}>
                  {Object.keys(priorityColors).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select value={detail.assignedAgent?.id ?? ''} onChange={e => patchTicket({ assignedAgentId: e.target.value || null })} style={{ ...inputStyle, width: 150, fontSize: '0.78rem' }}>
                  <option value="">Unassigned</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {detail.slaDueAt && <span style={{ fontSize: '0.72rem', color: new Date(detail.slaDueAt) < new Date() ? '#DC2626' : 'var(--text-muted)' }}>SLA {new Date(detail.slaDueAt) < new Date() ? 'breached' : 'due ' + timeAgo(detail.slaDueAt)}</span>}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {detail.comments.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No comments yet</p>}
              {detail.comments.map(c => (
                <div key={c.id} style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: '10px 14px', background: c.internal ? '#FEF3C7' : '#FFF' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-dark)' }}>
                      {c.author} {c.authorType === 'CUSTOMER' ? '(customer)' : ''} {c.internal && <span style={{ color: '#92400E' }}>· internal</span>} {c.body.startsWith('Auto:') && <span style={{ color: '#6B7280' }}>· system</span>}
                    </span>
                    <span>{timeAgo(c.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                  {c.attachments && c.attachments.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {c.attachments.map(a => (
                        <span key={a.id} onClick={() => apiFileUrl(a.id).then(url => window.open(url, '_blank')).catch(() => {})}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 10, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                          <PaperclipIcon /> {a.fileName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /> Internal note
                </label>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment…" rows={2} style={{ ...inputStyle, resize: 'none', flex: 1 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button onClick={() => ticketFileRef.current?.click()} className="btn-sm-outline" title="Attach a file">Attach</button>
                  <button onClick={addCommentBody} disabled={!comment.trim() && ticketFiles.length === 0} className="btn-primary">Post</button>
                </div>
              </div>
              {ticketFiles.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ticketFiles.map(f => (
                    <span key={f.id} style={{ background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 12, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PaperclipIcon /> {f.fileName}
                      <button onClick={() => setTicketFiles(files => files.filter(x => x.id !== f.id))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input ref={ticketFileRef} type="file" hidden onChange={uploadTicketFile} />
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }} onClick={() => setCreateOpen(false)}>
          <div className="data-card" style={{ width: 500, padding: 24, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem' }}>New Ticket</h3>
            <label style={labelStyle}>Customer</label>
            <div className="search-box" style={{ width: '100%', marginBottom: 8 }}>
              <input value={cusSearch} onChange={e => { setCusSearch(e.target.value); if (e.target.value.length > 1) searchCustomers(e.target.value); }} placeholder="Search by email or phone…" />
            </div>
            {cusResults.length > 0 && !form.subscriberId && (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, marginBottom: 12, maxHeight: 160, overflowY: 'auto' }}>
                {cusResults.map(c => (
                  <button key={c.id} onClick={() => { setForm({ ...form, subscriberId: c.id }); setCusSearch(c.user.email); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', fontSize: '0.82rem' }}>
                    <b>{c.user.email}</b>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{c.subscriptions[0]?.plan.name ?? 'no plan'} · {c.status}</span>
                  </button>
                ))}
              </div>
            )}
            <label style={labelStyle}>Subject</label>
            <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Ticket subject" style={{ ...inputStyle, marginBottom: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Category</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>
                  {['GENERAL', 'BILLING', 'TECHNICAL', 'INCIDENT', 'UPGRADE', 'INSTALLATION', 'LIVE_CHAT'].map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={inputStyle}>
                  {Object.keys(priorityColors).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} style={{ ...inputStyle, resize: 'vertical', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setCreateOpen(false)} className="btn-outline">Cancel</button>
              <button onClick={createTicket} disabled={!form.subscriberId || !form.subject.trim()} className="btn-primary">Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────── CANNED ───────────────────────────

function CannedTab({ toast, toasts, setToasts }: { toast: any; toasts: any[]; setToasts: (a: any[]) => void }) {
  const [items, setItems] = useState<Canned[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null | 'new'>(null);
  const [form, setForm] = useState({ title: '', body: '', category: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    try { setItems(await api<Canned[]>('/support/canned')); } catch {} finally { setLoading(false); }
  }

  function resetForm() { setForm({ title: '', body: '', category: '' }); setEditId(null); }

  async function save() {
    if (!form.title.trim() || !form.body.trim()) { return; }
    try {
      if (editId === 'new') {
        await api('/support/canned', { method: 'POST', body: JSON.stringify(form) });
        toast('Canned response created', 'success', toasts, setToasts);
      } else if (editId) {
        await api(`/support/canned/${editId}`, { method: 'PATCH', body: JSON.stringify(form) });
        toast('Canned response updated', 'success', toasts, setToasts);
      }
      resetForm();
      load();
    } catch (e: any) { toast(e.message || 'Save failed', 'error', toasts, setToasts); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this canned response?')) return;
    try {
      await api(`/support/canned/${id}`, { method: 'DELETE' });
      load();
      toast('Deleted', 'success', toasts, setToasts);
    } catch { toast('Delete failed', 'error', toasts, setToasts); }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>
      <div className="data-card">
        {loading ? <p style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</p>
          : items.length === 0 ? <p style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No canned responses yet</p>
          : <div className="table-scroll">
              <table>
                <thead><tr><th>Title</th><th>Category</th><th>Body</th><th>Used</th><th>Updated</th><th></th></tr></thead>
                <tbody>
                  {items.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{c.title}</td>
                      <td>{c.category}</td>
                      <td style={{ maxWidth: 380, fontSize: '0.8rem' }}>{c.body.length > 90 ? c.body.slice(0, 90) + '…' : c.body}</td>
                      <td>{c.usageCount}</td>
                      <td>{timeAgo(c.updatedAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => { setEditId(c.id); setForm({ title: c.title, body: c.body, category: c.category ?? '' }); }} className="btn-sm-outline">Edit</button>
                          <button onClick={() => remove(c.id)} className="btn-sm-outline" style={{ color: '#DC2626' }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </div>

      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 14 }}>{editId === 'new' ? 'New canned response' : editId ? 'Edit canned response' : 'Canned response'}</div>
        {editId !== null ? (
          <>
            <label style={labelStyle}>Title</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Billing receipt pointer" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={labelStyle}>Category</label>
            <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Billing / Technical / Sales" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={labelStyle}>Body</label>
            <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={7} placeholder="Response template…" style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={resetForm} className="btn-outline">Cancel</button>
              <button onClick={save} className="btn-primary">Save</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 14 }}>
              Reusable reply templates agents can drop into live chat conversations.
            </p>
            <button onClick={() => setEditId('new')} className="btn-primary">+ Add response</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── PERFORMANCE ───────────────────────────

function AnalyticsTab() {
  const [range, setRange] = useState('month');
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<PerfData>(`/support/performance?range=${range}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [range]);

  if (loading && !data) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  if (!data) return <p style={{ color: 'var(--text-muted)' }}>No performance data</p>;

  const cards = [
    { label: 'Chats Handled', value: data.totals.chatsHandled, color: 'var(--primary)' },
    { label: 'Closed Chats', value: data.totals.closedChats, color: '#16A34A' },
    { label: 'Tickets Resolved', value: data.totals.ticketsResolved, color: '#3B82F6' },
    { label: 'Avg CSAT', value: data.totals.avgCsat || '—', color: '#F59E0B' },
  ];

  const maxHandled = Math.max(...data.agents.map(a => a.chatsHandled), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="badge-tabs">
          {(['today', 'week', 'month'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)} className={`tab-item ${range === r ? 'active' : ''}`} style={{ border: 'none', background: 'transparent', textTransform: 'capitalize', fontWeight: 600 }}>{r}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>since {new Date(data.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {cards.map(c => (
          <div key={c.label} className="data-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: '1.7rem', fontWeight: 700, color: c.color, marginTop: 6 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 16 }}>Chats handled by agent</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.agents.map(a => (
            <div key={a.agentId}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{a.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({a.email.split('@')[0]}·{a.role})</span></span>
                <span>{a.chatsHandled} chats</span>
              </div>
              <div style={{ height: 8, background: '#F1F5F9', borderRadius: 6 }}>
                <div style={{ height: 8, width: `${Math.max((a.chatsHandled / maxHandled) * 100, 2)}%`, background: 'var(--primary)', borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="data-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Agent</th><th>Presence</th><th>Chats</th><th>Closed</th><th>Resolution</th>
                <th>Avg First Response</th><th>Avg Duration</th><th>CSAT</th><th>Tickets Resolved</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map(a => (
                <tr key={a.agentId}>
                  <td style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{a.name}<div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>{a.email}</div></td>
                  <td><span style={{ color: a.presence === 'ONLINE' ? '#16A34A' : a.presence === 'AWAY' ? '#CA8A04' : '#94A3B8', fontWeight: 600 }}>{a.presence}</span></td>
                  <td>{a.chatsHandled}</td>
                  <td>{a.closedChats}</td>
                  <td>{a.resolutionRate}%</td>
                  <td>{fmtDur(a.avgFirstResponseSec)}</td>
                  <td>{fmtDur(a.avgDurationSec)}</td>
                  <td>{a.avgCsat > 0 ? a.avgCsat + ' ★' : '—'}</td>
                  <td>{a.ticketsResolved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
