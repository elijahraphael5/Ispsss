'use client';

import { useEffect, useState, useRef, useCallback, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api, apiUpload, apiFileUrl } from '@isp/shared';
import { io, Socket } from 'socket.io-client';
import { SkeletonBlock, SkeletonTable } from '../components/Skeleton';

const CATEGORIES = [
  'Internet Down', 'Slow Speed', 'Billing', 'Payment', 'Installation',
  'Fiber Fault', 'Radio Signal', 'PPPoE Login', 'Router Issue', 'Static IP', 'Other',
];

const STATUS_COLORS: Record<string, string> = { OPEN: '#2563EB', IN_PROGRESS: '#CA8A04', RESOLVED: '#16A34A', CLOSED: '#94A3B8', ESCALATED: '#DC2626' };
const PRIORITY_COLORS: Record<string, string> = { LOW: '#6B7280', MEDIUM: '#2563EB', HIGH: '#EA580C', URGENT: '#DC2626' };

function TickIcon({ status }: { status: string }) {
  const color = status === 'READ' ? '#3b82f6' : '#94a3b8';
  if (status === 'SENT') {
    return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 4, verticalAlign: 'middle' }}><path d="M3 7.5l3 3 5-6" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  }
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: 4, verticalAlign: 'middle' }}><path d="M2 7.5l2.5 3 4-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 7.5l2.5 3 4-5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

interface TicketComment {
  id: string; author: string; authorType: string; body: string; internal: boolean; createdAt: string;
}
interface Ticket {
  id: string; subject: string; description: string | null; category: string | null;
  status: string; priority: string; slaDueAt: string | null;
  assignedAgent: { email: string } | null;
  comments: TicketComment[];
  createdAt: string; updatedAt: string;
}
interface ChatMsg {
  id: string; sessionId: string; senderId: string | null; senderName: string | null;
  senderType: 'CUSTOMER' | 'AGENT'; body: string;
  status: string; deliveredAt: string | null; readAt: string | null; createdAt: string;
  attachments?: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
}
interface ChatSession {
  id: string; status: string; csat: number | null;
  agentId: string | null; agent: { id: string; email: string } | null;
  messages: ChatMsg[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export default function SupportPage() {
  const { accessToken, user } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<'tickets' | 'chat'>('chat');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewTicket, setViewTicket] = useState<Ticket | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ subject: '', category: '', priority: 'MEDIUM', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [chatSession, setChatSession] = useState<ChatSession | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [chatMsg, setChatMsg] = useState('');
  const [chatTyping, setChatTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ id: string; fileName: string; sizeBytes: number }[]>([]);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeSessionRef = useRef<string | null>(null);

  const fetchTickets = useCallback(() => {
    api<Ticket[]>('/customer/tickets').then(setTickets).catch(() => {});
  }, []);

  useEffect(() => {
    if (!accessToken && typeof window !== 'undefined' && !localStorage.getItem('accessToken')) {
      router.push('/login');
    }
  }, [accessToken, router]);

  useEffect(() => {
    fetchTickets();
    api<ChatSession[]>('/chat/sessions').then(setChatSessions).catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchTickets]);

  useEffect(() => {
    if (!accessToken) return;
    const s = io(`${API_BASE.replace('/api/v1', '')}/chat`, {
      path: '/socket.io',
      auth: { token: accessToken },
      query: { role: 'customer' },
    });
    s.on('connect', () => { setSocket(s); s.emit('chat:getAgents'); });
    s.on('agent:count', (count: number) => setAgentsOnline(count));
    s.on('agent:online', () => setAgentsOnline(a => a + 1));
    s.on('agent:offline', () => setAgentsOnline(a => Math.max(0, a - 1)));

    s.on('chat:message', (msg: ChatMsg) => {
      if (msg.senderType === 'AGENT') s.emit('chat:read', msg.sessionId);
      setChatSession(prev => {
        if (!prev || prev.id !== msg.sessionId) return prev;
        return { ...prev, messages: [...(prev.messages ?? []).filter(m => m.id !== msg.id), msg] };
      });
      setChatSessions(prev => {
        const map = new Map(prev.map(x => [x.id, x]));
        const existing = map.get(msg.sessionId);
        if (existing) map.set(msg.sessionId, { ...existing, messages: [msg] });
        return Array.from(map.values());
      });
    });

    s.on('chat:read', (d: { sessionId: string; senderType: string; readAt: string }) => {
      setChatSession(prev => {
        if (!prev || prev.id !== d.sessionId || d.senderType !== 'CUSTOMER') return prev;
        return { ...prev, messages: prev.messages.map(m => m.senderType === 'CUSTOMER' ? { ...m, status: 'READ', readAt: d.readAt ?? m.readAt } : m) };
      });
    });

    s.on('chat:typing', (d: { sessionId: string; isTyping: boolean }) => {
      setChatTyping(d.isTyping && activeSessionRef.current === d.sessionId);
    });

    s.on('chat:sessionChanged', (d: { sessionId: string }) => {
      if (d.sessionId !== activeSessionRef.current) return;
      api<ChatSession>(`/chat/sessions/${d.sessionId}`).then(full => setChatSession(full)).catch(() => {});
    });

    s.on('chat:assigned', (d: { sessionId: string; agentId: string }) => {
      setChatSession(prev => prev && prev.id === d.sessionId ? { ...prev, agentId: d.agentId } : prev);
    });

    s.on('chat:error', (e: { message: string }) => alert(e.message || 'Chat error'));

    return () => { s.disconnect(); };
  }, [accessToken]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatSession?.messages, chatTyping]);

  const startChat = async () => {
    try {
      const session = await api<ChatSession>('/chat/sessions', { method: 'POST', body: JSON.stringify({}) });
      socket?.emit('chat:join', session.id);
      activeSessionRef.current = session.id;
      setChatSession({ ...session, messages: session.messages ?? [] });
      setTab('chat');
    } catch { alert('Failed to start chat'); }
  };

  const openChat = async (s: ChatSession) => {
    socket?.emit('chat:join', s.id);
    activeSessionRef.current = s.id;
    try {
      const full = await api<ChatSession>(`/chat/sessions/${s.id}`);
      setChatSession({ ...full, messages: full.messages ?? [] });
      if ((full.messages ?? []).some(m => m.senderType === 'AGENT')) socket?.emit('chat:read', s.id);
    } catch {
      setChatSession({ ...s, messages: s.messages ?? [] });
    }
  };

  const sendChatMsg = async () => {
    if ((!chatMsg.trim() && pendingFiles.length === 0) || !chatSession || sending) return;
    const text = chatMsg;
    const ids = pendingFiles.map(f => f.id);
    setChatMsg('');
    setPendingFiles([]);
    socket?.emit('chat:typing', { sessionId: chatSession.id, isTyping: false });
    setSending(true);
    try {
      const msg = await api<ChatMsg>(`/chat/sessions/${chatSession.id}/messages`, { method: 'POST', body: JSON.stringify({ body: text, attachmentIds: ids }) });
      setChatSession(prev => prev ? { ...prev, messages: [...(prev.messages ?? []).filter(m => m.id !== msg.id), msg] } : prev);
    } catch { alert('Failed to send message'); }
    finally { setSending(false); }
  };

  const uploadChatFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !chatSession) return;
    try {
      const up = await apiUpload<{ id: string; fileName: string; sizeBytes: number }>(`/chat/sessions/${chatSession.id}/attachments`, file);
      setPendingFiles(f => [...f, { id: up.id, fileName: up.fileName, sizeBytes: up.sizeBytes }]);
    } catch { alert('Upload failed — file must be 15 MB or smaller'); }
  };

  const endChat = async () => {
    if (!chatSession) return;
    try {
      await api(`/chat/sessions/${chatSession.id}/close`, { method: 'PATCH' });
      setChatSession(prev => prev ? { ...prev, status: 'CLOSED' } : prev);
    } catch {}
  };

  const submitRating = async (n: number) => {
    if (!chatSession) return;
    try {
      await api(`/chat/sessions/${chatSession.id}/rating`, { method: 'POST', body: JSON.stringify({ rating: n }) });
      setChatSession(prev => prev ? { ...prev, csat: n } : prev);
    } catch { alert('Failed to submit rating'); }
  };

  const fetchTicket = async (id: string) => {
    try {
      const t = await api<Ticket>(`/customer/tickets/${id}`);
      setViewTicket(t);
    } catch { alert('Failed to load ticket'); }
  };

  const openCount = (tickets ?? []).filter(t => t.status === 'OPEN' || t.status === 'IN_PROGRESS' || t.status === 'ESCALATED').length;

  if (!accessToken) return null;

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={200} height={28} />
      <SkeletonBlock width={130} height={38} borderRadius={20} />
      <div className="data-card" style={{ padding: 24 }}><SkeletonTable rows={5} cols={5} /></div>
    </div>;
  }

  if (viewTicket) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <button onClick={() => setViewTicket(null)} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', padding: 0 }}>&larr; Back to Tickets</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>{viewTicket.subject}</h1>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              {badge(viewTicket.status, STATUS_COLORS[viewTicket.status] ?? '#6B7280')}
              {badge(viewTicket.priority, PRIORITY_COLORS[viewTicket.priority] ?? '#6B7280')}
              {viewTicket.category && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{viewTicket.category}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <div>Created {new Date(viewTicket.createdAt).toLocaleDateString('en-GB')}</div>
            {viewTicket.assignedAgent && <div>Agent: {viewTicket.assignedAgent.email}</div>}
            {viewTicket.slaDueAt && <div>SLA: {new Date(viewTicket.slaDueAt).toLocaleDateString('en-GB')}</div>}
          </div>
        </div>
        <div className="data-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 12 }}>Conversation</h3>
          {viewTicket.description && (
            <div style={{ padding: '12px 16px', borderRadius: 16, backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', marginBottom: 12, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
              {viewTicket.description}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflowY: 'auto' }}>
            {viewTicket.comments.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No messages yet</p>
            ) : viewTicket.comments.filter(c => !c.internal).map(c => {
              const isStaff = c.authorType === 'AGENT';
              return (
                <div key={c.id} style={{ padding: '12px 16px', borderRadius: 16, backgroundColor: isStaff ? '#F0F4FF' : '#F8FAFC', alignSelf: isStaff ? 'flex-start' : 'flex-end', maxWidth: '80%', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.75rem' }}>
                    <span style={{ fontWeight: 600, color: isStaff ? '#2563EB' : 'var(--text-dark)' }}>{isStaff ? `Support Agent${c.author ? ` (${c.author.split('@')[0]})` : ''}` : 'You'}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(c.createdAt).toLocaleString('en-GB')}</span>
                  </div>
                  <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={2} placeholder="Type your reply..." style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', resize: 'none' }} />
            <button className="btn-primary" style={{ alignSelf: 'flex-end', padding: '10px 20px' }} disabled={replySubmitting || !replyText.trim()} onClick={async () => {
              setReplySubmitting(true);
              try { await api(`/customer/tickets/${viewTicket.id}/reply`, { method: 'POST', body: JSON.stringify({ message: replyText }) }); setReplyText(''); await fetchTicket(viewTicket.id); } catch { alert('Failed to send reply'); }
              finally { setReplySubmitting(false); }
            }}>Send</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>Support</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Get help via live chat or support tickets</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Open Tickets</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#2563EB' }}>{openCount}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Total Tickets</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{tickets.length}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Agents Online</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: agentsOnline > 0 ? '#16A34A' : '#94A3B8' }}>{agentsOnline}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Service Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: openCount > 0 ? '#F59E0B' : '#16A34A' }} />
            <span style={{ fontSize: '1rem', fontWeight: 700, color: openCount > 0 ? '#F59E0B' : '#16A34A' }}>{openCount > 0 ? 'Active Issues' : 'Operational'}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {(['tickets', 'chat'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', background: tab === t ? 'var(--primary)' : '#fff', color: tab === t ? '#fff' : 'var(--text-color)', textTransform: 'capitalize' }}>
            {t === 'tickets' ? 'Tickets' : 'Live Chat'}
          </button>
        ))}
        {tab === 'tickets' && (
          <button className="btn-primary" onClick={() => setShowNew(true)} style={{ marginLeft: 'auto' }}>New Ticket</button>
        )}
      </div>

      {tab === 'tickets' && (
        <div className="data-card" style={{ padding: 0 }}>
          <div className="table-container"><div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Category</th><th>Status</th><th>Priority</th><th>Agent</th><th>Created</th></tr></thead>
              <tbody>
                {tickets.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No tickets yet</td></tr>
                ) : tickets.map(t => (
                  <tr key={t.id} onClick={() => fetchTicket(t.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{t.subject}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.category ?? '—'}</td>
                    <td>{badge(t.status, STATUS_COLORS[t.status] ?? '#6B7280')}</td>
                    <td>{badge(t.priority, PRIORITY_COLORS[t.priority] ?? '#6B7280')}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t.assignedAgent?.email ?? 'Unassigned'}</td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{new Date(t.createdAt).toLocaleDateString('en-GB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        </div>
      )}

      {tab === 'chat' && (
        <div className="data-card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          {!chatSession ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, gap: 16 }}>
              <svg width="48" height="48" fill="none" stroke="var(--primary)" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Live Chat</h3>
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: 360 }}>
                {agentsOnline > 0
                  ? `${agentsOnline} agent${agentsOnline > 1 ? 's' : ''} online. Start a chat and we'll connect you.`
                  : 'No agents are currently online. Start a chat and we\'ll respond as soon as one is available, or create a ticket instead.'}
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn-primary" onClick={startChat}>Start Live Chat</button>
                <button className="btn-primary" style={{ background: '#8B5CF6' }} onClick={() => { setTab('tickets'); setShowNew(true); }}>Create Ticket</button>
              </div>

              {chatSessions.length > 0 && (
                <div style={{ width: '100%', maxWidth: 420, marginTop: 8 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>Previous chats</div>
                  {chatSessions.map(s => (
                    <div key={s.id} onClick={() => openChat(s)}
                      style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', marginBottom: 8, background: '#FFF' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Chat #{s.id.slice(0, 8)}</span>
                      <span style={{ fontSize: '0.75rem', color: s.status === 'CLOSED' ? 'var(--text-muted)' : '#16A34A' }}>{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Live Chat</span>
                  {chatSession.agentId && <span style={{ fontSize: '0.75rem', color: '#16A34A', marginLeft: 8 }}>● Agent connected</span>}
                  {chatTyping && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>Agent typing...</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={async () => {
                    socket?.emit('chat:leave', chatSession.id); activeSessionRef.current = null; await endChat();
                  }}
                    style={{ background: 'none', border: 'none', color: chatSession.status === 'CLOSED' ? 'var(--text-muted)' : '#DC2626', cursor: 'pointer', fontSize: '0.8rem' }}>
                    {chatSession.status === 'CLOSED' ? 'Closed' : 'End Chat'}
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(chatSession.messages ?? []).length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>No messages yet. Start the conversation.</p>
                ) : chatSession.messages.map(m => {
                  const mine = m.senderType === 'CUSTOMER';
                  return (
                    <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '75%', alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                      <div style={{ padding: '10px 14px', borderRadius: 16, backgroundColor: mine ? 'var(--primary)' : '#F0F4FF', color: mine ? '#fff' : 'inherit' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: 4, opacity: 0.8 }}>{m.senderName || (mine ? 'You' : 'Agent')}</div>
                        <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{m.body}</div>
                        {m.attachments && m.attachments.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: m.body ? 8 : 0 }}>
                            {m.attachments.map(a => (
                              <div key={a.id} onClick={() => apiFileUrl(a.id).then(url => window.open(url, '_blank')).catch(() => {})}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '4px 9px', textDecoration: 'underline' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                                {a.fileName}
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ fontSize: '0.65rem', marginTop: 4, opacity: 0.6, textAlign: 'right' }}>{new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                      {mine && <TickIcon status={m.status} />}
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              {chatSession.status === 'CLOSED' && chatSession.csat === null ? (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>How was your chat experience?</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => submitRating(n)} style={{ fontSize: '1.4rem', background: 'none', border: 'none', cursor: 'pointer', color: '#F59E0B' }}>★</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: 10 }}>
                  <input value={chatMsg} onChange={e => { setChatMsg(e.target.value); socket?.emit('chat:typing', { sessionId: chatSession.id, isTyping: e.target.value.length > 0 }); }}
                    onKeyDown={e => e.key === 'Enter' && sendChatMsg()} placeholder="Type a message..." disabled={chatSession.status === 'CLOSED'}
                    style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
                  <button onClick={() => chatFileRef.current?.click()} disabled={chatSession.status === 'CLOSED'} className="btn-outline" title="Attach a file" style={{ padding: '10px 14px' }}>Attach</button>
                  <button className="btn-primary" onClick={sendChatMsg} disabled={(!chatMsg.trim() && pendingFiles.length === 0) || sending || chatSession.status === 'CLOSED'} style={{ padding: '10px 20px' }}>Send</button>
                </div>
              )}
              {pendingFiles.length > 0 && (
                <div style={{ padding: '0 16px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {pendingFiles.map(f => (
                    <span key={f.id} style={{ background: 'var(--primary-light)', color: 'var(--primary)', borderRadius: 12, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {f.fileName}
                      <button onClick={() => setPendingFiles(files => files.filter(x => x.id !== f.id))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input ref={chatFileRef} type="file" hidden onChange={uploadChatFile} />
            </div>
          )}
        </div>
      )}

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowNew(false)}>
          <div style={{ background: 'white', padding: 32, width: 520, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Create Ticket</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowNew(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }}>
                  <option value="">Select category</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Priority</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Subject</label>
                <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Brief summary of your issue"
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={5} placeholder="Describe your issue in detail"
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', resize: 'vertical' }} />
              </div>
              <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={submitting || !form.subject} onClick={async () => {
                setSubmitting(true);
                try {
                  await api('/customer/tickets', { method: 'POST', body: JSON.stringify({ subject: form.subject, description: form.description, category: form.category || undefined, priority: form.priority }) });
                  setShowNew(false);
                  setForm({ subject: '', category: '', priority: 'MEDIUM', description: '' });
                  fetchTickets();
                } catch { alert('Failed to create ticket'); }
                finally { setSubmitting(false); }
              }}>{submitting ? 'Submitting...' : 'Submit Ticket'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
