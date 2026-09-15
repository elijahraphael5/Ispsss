'use client';

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, apiUpload, apiFileUrl, useAuthStore, timeAgo, formatNaira } from '@isp/shared';
import { useToast, ToastContainer } from '../../components/Toast';
import {
  MessageCircle,
  MessagesSquare,
  MessageSquare,
  Ticket as TicketIconLucide,
  Zap,
  BarChart3,
  Clock,
  User,
  UserCheck,
  CheckCircle,
  CheckCircle2,
  Check,
  CheckCheck,
  Inbox,
  Search,
  X,
  Send,
  Paperclip,
  Package,
  HardDrive,
  Receipt,
  FileText,
  Star as StarLucide,
  Mail,
  Phone,
  MapPin,
  ChevronDown,
  ChevronLeft,
  ArrowRight,
  Sparkles,
  Users,
  Activity,
  ShieldCheck,
  Plus,
} from 'lucide-react';

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
  return <StarLucide size={16} strokeWidth={filled ? 2 : 1.8} fill={filled ? '#F59E0B' : 'none'} color={filled ? '#F59E0B' : '#D1D5DB'} style={{ flexShrink: 0 }} />;
}

function TickIcon({ status }: { status: string }) {
  const color = status === 'READ' ? '#3B82F6' : '#94A3B8';
  return <CheckCheck size={14} strokeWidth={2} color={color} style={{ marginLeft: 4, flexShrink: 0, verticalAlign: 'middle' }} />;
}

function PaperclipIcon() {
  return <Paperclip size={13} strokeWidth={2} style={{ flexShrink: 0 }} />;
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-color)',
  fontSize: '0.85rem', outline: 'none', background: '#fff', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 5, fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' };
const pillSelect: React.CSSProperties = { padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.8rem', background: '#fff', cursor: 'pointer', color: 'var(--text-dark)', outline: 'none' };

const avatarPalette = ['#F15925', '#2563EB', '#16A34A', '#8B5CF6', '#F59E0B', '#0EA5E9', '#EC4899', '#14B8A6'];
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}
function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: avatarColor(name), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.36, fontWeight: 700, flexShrink: 0 }}>
      {initialsOf(name)}
    </div>
  );
}

// ─────────────────────────── page ───────────────────────────

type HubTab = 'chat' | 'tickets' | 'canned' | 'analytics';

export default function SupportHub() {
  const { user, accessToken } = useAuthStore();
  const { toast } = useToast();
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);

  const [tab, setTab] = useState<HubTab>('chat');
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [agentsOnline, setAgentsOnline] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    if (!tabMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) setTabMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tabMenuOpen]);

  const HUB_TABS: { key: HubTab; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: 'chat', label: 'Live Chat', desc: 'Real-time customer conversations', icon: <MessageCircle size={16} strokeWidth={2} /> },
    { key: 'tickets', label: 'Tickets', desc: 'Track and resolve support tickets', icon: <TicketIconLucide size={16} strokeWidth={2} /> },
    { key: 'canned', label: 'Canned Replies', desc: 'Saved response templates', icon: <Zap size={16} strokeWidth={2} /> },
    { key: 'analytics', label: 'Performance', desc: 'Agent and SLA statistics', icon: <BarChart3 size={16} strokeWidth={2} /> },
  ];
  const activeTab = HUB_TABS.find(t => t.key === tab) ?? HUB_TABS[0];

  return (
    <>
      <ToastContainer toasts={toasts} />
      <div className="page-title-row">
        <h1 className="page-title">Support</h1>
      </div>

      <div ref={tabMenuRef} style={{ position: 'relative', width: 'fit-content' }}>
        <button className="hub-tab-btn" onClick={() => setTabMenuOpen(o => !o)} aria-expanded={tabMenuOpen}>
          <span style={{ color: 'var(--primary)', display: 'flex' }}>{activeTab.icon}</span>
          {activeTab.label}
          <ChevronDown size={14} strokeWidth={2} style={{ transition: 'transform 0.2s', transform: tabMenuOpen ? 'rotate(180deg)' : 'none', color: 'var(--text-muted)' }} />
        </button>

        {tabMenuOpen && (
          <div className="hub-tab-menu">
            {HUB_TABS.map(t => (
              <button key={t.key} onClick={() => { setTab(t.key); setTabMenuOpen(false); }}
                className={`hub-tab-menu-item${tab === t.key ? ' active' : ''}`}>
                <span style={{ color: tab === t.key ? 'var(--primary)' : 'var(--text-muted)', display: 'flex', flexShrink: 0 }}>{t.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-dark)' }}>{t.label}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{t.desc}</span>
                </span>
                {tab === t.key && (
                  <Check size={15} strokeWidth={2.5} color="var(--primary)" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                )}
              </button>
            ))}
          </div>
        )}
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
  const boardRef = useRef<HTMLDivElement>(null);
  const [listSearch, setListSearch] = useState('');

  function showPane(index: number) {
    const board = boardRef.current;
    if (!board || !window.matchMedia('(max-width: 900px)').matches) return;
    const pane = board.children[index] as HTMLElement | undefined;
    pane?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

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
      requestAnimationFrame(() => showPane(1));
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
  const closedCount = rows.filter(r => r.status === 'CLOSED').length;
  const filteredRows = rows.filter(r => {
    if (!listSearch.trim()) return true;
    const q = listSearch.toLowerCase();
    return (r.customerName ?? '').toLowerCase().includes(q) || r.customerEmail.toLowerCase().includes(q) || (r.lastMessage?.body ?? '').toLowerCase().includes(q);
  });

  const scopeTabs: { key: 'queue' | 'assigned' | 'closed'; label: string; count: number; icon: React.ReactNode; desc: string }[] = [
    { key: 'queue', label: 'Queue', count: waitingCount, desc: 'Waiting', icon: <Clock size={14} strokeWidth={2} /> },
    { key: 'assigned', label: 'Mine', count: mineCount, desc: 'Assigned to you', icon: <UserCheck size={14} strokeWidth={2} /> },
    { key: 'closed', label: 'Closed', count: closedCount, desc: 'Resolved', icon: <CheckCircle size={14} strokeWidth={2} /> },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* sweet header bar */}
      <div className="data-card live-gradient-header" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', border: '1px solid #FFE7D6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(135deg,#F15925 0%, #FF8A4C 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 6px 16px rgba(241,89,37,0.3)', flexShrink: 0 }}>
            <MessagesSquare size={20} strokeWidth={2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-dark)', letterSpacing: '-0.2px', display: 'flex', alignItems: 'center', gap: 8 }}>
              Live Chat HQ
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #FFE7D6', borderRadius: 20, padding: '3px 9px', fontSize: '0.68rem', fontWeight: 700, color: agentsOnline > 0 ? '#16A34A' : '#94A3B8' }}>
                <span className={agentsOnline > 0 ? 'live-dot-pulse' : ''} style={{ width: 7, height: 7, borderRadius: '50%', background: agentsOnline > 0 ? '#16A34A' : '#94A3B8', display: 'inline-block' }} />
                {agentsOnline} online
              </span>
            </div>
            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 1, fontWeight: 500 }}>Delight customers in seconds — fast, warm, human.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {[
            { label: 'Queue', value: waitingCount, bg: '#FFF7ED', color: '#C2410C', Icon: Clock },
            { label: 'Mine', value: mineCount, bg: '#EFF6FF', color: '#1D4ED8', Icon: UserCheck },
            { label: 'Closed', value: closedCount, bg: '#F0FDF4', color: '#15803D', Icon: CheckCircle2 },
          ].map(card => (
            <div key={card.label} style={{ background: card.bg, border: '1px solid rgba(0,0,0,0.04)', borderRadius: 16, padding: '10px 14px', minWidth: 86, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', color: card.color }}><card.Icon size={16} strokeWidth={2} /></div>
              <div>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{card.label}</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: card.color, lineHeight: 1 }}>{card.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="tickets-board" ref={boardRef} style={{ gap: 16 }}>
        {/* ── LEFT: inbox ── */}
        <div className="data-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 4px 20px rgba(15,23,42,0.06)' }}>
          <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid #F1F5F9', background: '#FFFFFF' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 9, background: '#FFF7ED', color: '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Inbox size={15} strokeWidth={2} />
                </span>
                Inbox
              </div>
              <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#94A3B8', background: '#F8FAFC', border: '1px solid #F1F5F9', padding: '4px 8px', borderRadius: 20 }}>{filteredRows.length} chats</span>
            </div>

            <div className="badge-tabs" style={{ display: 'flex', padding: 3, gap: 2, background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 20 }}>
              {scopeTabs.map(t => (
                <button key={t.key} onClick={() => setScope(t.key)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '7px 8px', borderRadius: 16, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem',
                    background: scope === t.key ? '#FFFFFF' : 'transparent',
                    color: scope === t.key ? (t.key === 'queue' ? '#C2410C' : t.key === 'assigned' ? '#1D4ED8' : '#15803D') : 'var(--text-muted)',
                    boxShadow: scope === t.key ? '0 1px 6px rgba(15,23,42,0.08)' : 'none',
                    transition: 'all 0.18s ease',
                    whiteSpace: 'nowrap',
                  }}>
                  <span style={{ opacity: scope === t.key ? 1 : 0.7, display: 'flex' }}>{t.icon}</span>
                  {t.label}
                  <span style={{
                    background: scope === t.key ? (t.key === 'queue' ? '#FFEDD5' : t.key === 'assigned' ? '#DBEAFE' : '#DCFCE7') : '#FFFFFF',
                    color: scope === t.key ? (t.key === 'queue' ? '#9A3412' : t.key === 'assigned' ? '#1E40AF' : '#166534') : 'var(--text-muted)',
                    borderRadius: 10, padding: '1px 6px', fontSize: '0.65rem', fontWeight: 800, border: '1px solid rgba(0,0,0,0.04)'
                  }}>{t.count}</span>
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10, position: 'relative' }}>
              <Search size={14} strokeWidth={2} color="#94A3B8" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
                placeholder="Search by name, email, message…"
                style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 12, border: '1px solid #E2E8F0', background: '#F8FAFC', fontSize: '0.78rem', outline: 'none', color: 'var(--text-dark)', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div className="live-scroll" style={{ flex: 1, overflowY: 'auto', background: '#FFFFFF' }}>
            {loading ? (
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)', backgroundSize: '200% 100%', animation: 'shimmer-live 1.4s infinite' }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ height: 10, borderRadius: 6, background: '#F1F5F9', width: '60%' }} />
                      <div style={{ height: 8, borderRadius: 6, background: '#F8FAFC', width: '85%' }} />
                    </div>
                  </div>
                ))}
                <p style={{ textAlign: 'center', paddingTop: 8, color: 'var(--text-muted)', fontSize: '0.78rem' }}>Waking up your inbox…</p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '28px 18px', textAlign: 'center' }}>
                <div className="live-float" style={{ width: 72, height: 72, borderRadius: 22, background: 'linear-gradient(135deg,#FFF7ED 0%, #FFEDD5 100%)', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F15925' }}>
                  <Inbox size={32} strokeWidth={1.6} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-dark)' }}>{scope === 'queue' ? 'All caught up! 🎉' : scope === 'assigned' ? 'Nothing assigned yet' : 'No closed chats'}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>{scope === 'queue' ? 'No one is waiting. New chats will pop in instantly.' : scope === 'assigned' ? 'Chats assigned to you will appear here. Stay tuned!' : 'Closed conversations will live here for review.'}</div>
                </div>
                {listSearch && <div style={{ fontSize: '0.72rem', color: '#94A3B8', background: '#F8FAFC', padding: '6px 10px', borderRadius: 20, border: '1px solid #F1F5F9' }}>No match for “{listSearch}” • <button onClick={() => setListSearch('')} style={{ background: 'none', border: 'none', color: '#F15925', fontWeight: 700, cursor: 'pointer', fontSize: '0.72rem' }}>Clear</button></div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: '0.66rem', fontWeight: 600, color: '#94A3B8', background: '#F8FAFC', border: '1px dashed #E2E8F0', padding: '5px 10px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={11} strokeWidth={2} /> Tip: Try “Closed” to see history</span>
                </div>
              </div>
            ) : filteredRows.map(r => {
              const displayName = r.customerName || r.customerEmail.split('@')[0];
              const active = session?.id === r.id;
              const isWaiting = r.status === 'WAITING';
              return (
                <div key={r.id} onClick={() => openSession(r)}
                  className={`session-row ${active ? 'active' : ''}`}
                  style={{ display: 'flex', gap: 12, padding: '13px 14px', borderBottom: '1px solid #F8FAFC', cursor: 'pointer', background: active ? undefined : '#fff', alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Avatar name={displayName} size={42} />
                    <span style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: '50%', background: isWaiting ? '#F59E0B' : r.status === 'ACTIVE' ? '#16A34A' : '#94A3B8', border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.1px' }}>{displayName}</span>
                      <span style={{ fontSize: '0.64rem', color: active ? '#F15925' : 'var(--text-muted)', fontWeight: 700, flexShrink: 0, background: active ? '#FFF7ED' : '#F8FAFC', padding: '3px 7px', borderRadius: 10, border: '1px solid ' + (active ? '#FFE7D6' : '#F1F5F9') }}>{timeAgo(r.updatedAt)}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.customerEmail}</div>
                    <div style={{ fontSize: '0.76rem', color: r.lastMessage ? '#334155' : '#94A3B8', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 10, padding: '6px 9px', fontStyle: r.lastMessage ? 'normal' : 'italic' }}>
                      {r.lastMessage ? `${r.lastMessage.senderType === 'AGENT' ? 'You: ' : ''}${r.lastMessage.body}` : '— no messages yet —'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 20, background: r.status === 'WAITING' ? '#FFFBEB' : r.status === 'ACTIVE' ? '#F0FDF4' : '#F8FAFC', color: r.status === 'WAITING' ? '#B45309' : r.status === 'ACTIVE' ? '#15803D' : '#64748B', border: '1px solid ' + (r.status === 'WAITING' ? '#FDE68A' : r.status === 'ACTIVE' ? '#BBF7D0' : '#E2E8F0') }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.status === 'WAITING' ? '#F59E0B' : r.status === 'ACTIVE' ? '#16A34A' : '#94A3B8' }} />
                        {r.status}
                      </span>
                      {r.agentId && r.agentId !== user?.id && (
                        <span style={{ fontSize: '0.66rem', color: '#64748B', background: '#F1F5F9', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>↗ {agents.find(a => a.id === r.agentId)?.name ?? 'other agent'}</span>
                      )}
                      {r.unreadCount > 0 && (
                        <span style={{ marginLeft: 'auto', background: 'linear-gradient(135deg,#DC2626 0%, #EF4444 100%)', color: '#fff', borderRadius: 20, padding: '2px 8px', fontSize: '0.66rem', fontWeight: 800, boxShadow: '0 2px 8px rgba(220,38,38,0.3)' }}>{r.unreadCount} new</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CENTER: thread ── */}
        <div className="data-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 4px 20px rgba(15,23,42,0.06)', background: '#FFFFFF' }}>
          {!session ? (
            <div className="live-gradient-mesh" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '28px 24px', textAlign: 'center' }}>
              <div className="live-float" style={{ width: 88, height: 88, borderRadius: 28, background: 'linear-gradient(135deg,#FFFFFF 0%, #FFF7ED 100%)', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(241,89,37,0.15)', color: '#F15925' }}>
                <MessagesSquare size={38} strokeWidth={1.6} />
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-dark)', letterSpacing: '-0.3px' }}>Select a conversation</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 6, maxWidth: 360, lineHeight: 1.55 }}>Pick a chat from the left to start replying. You’ll see the full thread, customer context, and quick actions right here.</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, width: '100%', maxWidth: 420, marginTop: 4 }}>
                {[
                  { Icon: Zap, title: 'Instant', desc: 'Real-time replies' },
                  { Icon: MessageSquare, title: 'Canned', desc: 'One-click answers' },
                  { Icon: Paperclip, title: 'Files', desc: 'Share & preview' },
                ].map(f => (
                  <div key={f.title} className="chat-quick-card" style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 16, padding: '12px 10px', boxShadow: '0 1px 6px rgba(15,23,42,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: '#FFF7ED', color: '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><f.Icon size={14} strokeWidth={2} /></div>
                    <div style={{ fontWeight: 800, fontSize: '0.76rem', color: 'var(--text-dark)', marginTop: 4 }}>{f.title}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 1 }}>{f.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600 }}>Tip:</span>
                <span style={{ fontSize: '0.72rem', color: '#64748B', background: '#fff', border: '1px solid #E2E8F0', padding: '6px 10px', borderRadius: 20 }}>Queue shows waiting customers • Mine shows your chats</span>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: '13px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'linear-gradient(180deg,#FFFFFF 0%, #FFFBF8 100%)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: '1 1 200px' }}>
                  <button className="chat-back-btn" onClick={() => showPane(0)} title="Back to sessions" aria-label="Back to sessions">
                    <ChevronLeft size={16} strokeWidth={2} />
                  </button>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Avatar name={session.customerName || session.customerEmail.split('@')[0] || 'Customer'} size={42} />
                    <span style={{ position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: '50%', background: session.status === 'CLOSED' ? '#94A3B8' : '#16A34A', border: '2px solid #fff', boxShadow: '0 1px 6px rgba(0,0,0,0.12)' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: 7, letterSpacing: '-0.2px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.customerName || session.customerEmail.split('@')[0] || 'Customer'}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: session.status === 'WAITING' ? '#FFFBEB' : session.status === 'ACTIVE' ? '#F0FDF4' : '#F1F5F9', color: session.status === 'WAITING' ? '#B45309' : session.status === 'ACTIVE' ? '#15803D' : '#64748B', border: '1px solid ' + (session.status === 'WAITING' ? '#FDE68A' : session.status === 'ACTIVE' ? '#BBF7D0' : '#E2E8F0') }}>{session.status}</span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{session.customerEmail} • started {timeAgo(session.createdAt)}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 20, padding: '4px 6px 4px 10px' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)' }}>Assign</span>
                    <select value={session.agentId ?? ''} onChange={e => e.target.value && transferTo(e.target.value)} style={{ border: 'none', background: '#fff', borderRadius: 20, padding: '5px 8px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-dark)', outline: 'none', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                      <option value="">{session.agentId ? 'Assigned' : 'Unassigned'}</option>
                      {transferTargets.map(a => <option key={a.id} value={a.id}>{a.name}{a.presence === 'ONLINE' ? ' ●' : ''}</option>)}
                    </select>
                  </div>
                  <button onClick={() => setConvertOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 20, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.72rem', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
                    <TicketIconLucide size={13} strokeWidth={2} />
                    Ticket
                  </button>
                  <button onClick={closeCurrent} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 20, border: '1px solid ' + (session.status === 'CLOSED' ? '#E2E8F0' : '#FECACA'), background: session.status === 'CLOSED' ? '#F8FAFC' : 'linear-gradient(135deg,#FFF1F2 0%, #FFE4E6 100%)', color: session.status === 'CLOSED' ? '#64748B' : '#BE123C', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: session.status === 'CLOSED' ? '#94A3B8' : '#E11D48' }} />
                    {session.status === 'CLOSED' ? 'Closed' : 'End Chat'}
                  </button>
                </div>
              </div>

              <div ref={endRef} className="live-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 18px 10px', display: 'flex', flexDirection: 'column', gap: 10, background: 'linear-gradient(180deg,#F8FAFC 0%, #FFFFFF 100%)' }}>
                {session.messages.length === 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 12px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 16, background: '#fff', border: '1px dashed #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
                      <MessageCircle size={22} strokeWidth={1.6} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text-dark)' }}>No messages yet</div>
                    <div style={{ fontSize: '0.76rem' }}>Say hello! 👋 Customers love a warm, quick opener.</div>
                  </div>
                )}
                {session.messages.map(m => {
                  const mine = m.senderType === 'AGENT';
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      <div style={{ maxWidth: '76%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 4 }}>
                        {!mine && (
                          <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--text-muted)', marginLeft: 2 }}>{m.senderName ?? 'Customer'}</span>
                        )}
                        <div className={mine ? 'live-bubble-agent' : 'live-bubble-customer'} style={{
                          padding: '10px 14px', borderRadius: 18, fontSize: '0.84rem', lineHeight: 1.5,
                          color: mine ? '#fff' : '#1E293B',
                          borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6,
                          maxWidth: '100%', wordBreak: 'break-word'
                        }}>
                          {m.body}
                          {m.attachments?.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: m.body ? 8 : 0 }}>
                              {m.attachments.map(a => (
                                <div key={a.id} onClick={() => openFile(a)} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: '0.74rem', background: mine ? 'rgba(255,255,255,0.18)' : '#F8FAFC', border: mine ? '1px solid rgba(255,255,255,0.18)' : '1px solid #E2E8F0', borderRadius: 10, padding: '6px 10px', textDecoration: 'none', fontWeight: 600, color: mine ? '#fff' : '#334155' }}>
                                  <PaperclipIcon /> <span>{a.fileName}</span> <span style={{ marginLeft: 'auto', opacity: 0.7, fontSize: '0.68rem' }}>open ↗</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: '0.64rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px', fontWeight: 600 }}>
                          {fmtTime(m.createdAt)}
                          {mine && <TickIcon status={m.status} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {typing && typing.sessionId === session.id && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 18, borderBottomLeftRadius: 6, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 10px rgba(15,23,42,0.06)' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', display: 'inline-block', animation: 'pulse-live 1s infinite' }} />
                      <span style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 600, fontStyle: 'italic' }}>Customer is typing…</span>
                      <span style={{ display: 'inline-flex', gap: 3, marginLeft: 4 }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#CBD5E1', display: 'inline-block', animation: 'float-gentle 1s infinite' }} />
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#CBD5E1', display: 'inline-block', animation: 'float-gentle 1s 0.15s infinite' }} />
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#CBD5E1', display: 'inline-block', animation: 'float-gentle 1s 0.3s infinite' }} />
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ padding: '12px 14px 14px', borderTop: '1px solid #F1F5F9', background: '#fff' }}>
                {pendingFiles.length > 0 && (
                  <div style={{ marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {pendingFiles.map(f => (
                      <span key={f.id} style={{ background: '#FFF7ED', color: '#9A3412', border: '1px solid #FFE7D6', borderRadius: 20, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <PaperclipIcon /> {f.fileName}
                        <button onClick={() => setPendingFiles(files => files.filter(x => x.id !== f.id))} style={{ background: '#fff', border: '1px solid #FFE7D6', color: '#9A3412', cursor: 'pointer', fontWeight: 800, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={10} strokeWidth={2.5} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="composer-wrap" style={{ padding: '8px 8px 8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    value={composer}
                    onChange={e => {
                      setComposer(e.target.value);
                      if (socket?.connected) socket.emit('chat:typing', { sessionId: session.id, isTyping: e.target.value.length > 0 });
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Type a warm, helpful reply…  (Enter to send • Shift+Enter for new line)"
                    rows={2}
                    style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', maxHeight: 90, fontSize: '0.86rem', lineHeight: 1.5, color: 'var(--text-dark)', background: 'transparent', fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                    <button onClick={() => setCannedOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 20, border: '1px solid #E2E8F0', background: cannedOpen ? '#FFF7ED' : '#F8FAFC', color: cannedOpen ? '#9A3412' : '#64748B', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>
                      <Zap size={13} strokeWidth={2} />
                      Canned
                    </button>
                    <button onClick={() => fileInputRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 20, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>
                      <Paperclip size={13} strokeWidth={2} />
                      Attach
                    </button>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '0.66rem', color: '#94A3B8', fontWeight: 600, display: composer.length > 100 ? 'inline' : 'none' }}>{composer.length} chars</span>
                      <button onClick={sendMessage} disabled={!composer.trim() && pendingFiles.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 20, border: 'none', background: (!composer.trim() && pendingFiles.length === 0) ? '#F1F5F9' : 'linear-gradient(135deg,#F15925 0%, #EA4B1B 100%)', color: (!composer.trim() && pendingFiles.length === 0) ? '#94A3B8' : '#fff', fontWeight: 800, fontSize: '0.78rem', cursor: (!composer.trim() && pendingFiles.length === 0) ? 'not-allowed' : 'pointer', boxShadow: (!composer.trim() && pendingFiles.length === 0) ? 'none' : '0 4px 12px rgba(241,89,37,0.3)', transition: 'all 0.18s ease' }}>
                        Send
                        <Send size={14} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                </div>
                <input ref={fileInputRef} type="file" hidden onChange={attachFile} />
                {cannedOpen && (
                  <div style={{ marginTop: 10, border: '1px solid #FFE7D6', borderRadius: 16, maxHeight: 200, overflowY: 'auto', background: '#FFFBF5', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}>
                    <div style={{ padding: '10px 14px 8px', fontSize: '0.66rem', fontWeight: 800, color: '#9A3412', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Sparkles size={12} strokeWidth={2} /> Quick replies</span>
                      <button onClick={() => setCannedOpen(false)} style={{ background: '#fff', border: '1px solid #FFE7D6', borderRadius: 20, padding: '2px 8px', fontSize: '0.66rem', fontWeight: 700, color: '#9A3412', cursor: 'pointer' }}>Close</button>
                    </div>
                    {canned.length === 0 && <p style={{ padding: '12px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No templates yet — create some in Canned Replies tab!</p>}
                    {canned.map(c => (
                      <button key={c.id}
                        onClick={() => { setComposer(prev => (prev ? prev + ' ' : '') + c.body); setCannedOpen(false); }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: '#fff', cursor: 'pointer', borderTop: '1px solid #FFF7ED', fontSize: '0.82rem', transition: 'background 0.14s' }}>
                        <strong style={{ color: 'var(--text-dark)' }}>{c.title}</strong>
                        <span style={{ display: 'block', color: '#64748B', fontSize: '0.73rem', marginTop: 2, lineHeight: 1.4 }}>{c.body.slice(0, 98)}{c.body.length > 98 ? '…' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT: context ── */}
        <div className="data-card live-scroll" style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: '0 4px 20px rgba(15,23,42,0.06)' }}>
          {!session ? (
            <div style={{ padding: '22px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', flex: 1, justifyContent: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg,#EFF6FF 0%, #DBEAFE 100%)', border: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}>
                <Users size={28} strokeWidth={1.6} />
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: '0.92rem', color: 'var(--text-dark)' }}>Customer context</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>Select a chat to see plan, devices, invoices and tickets — everything you need to help, without asking twice.</div>
              </div>
              <div style={{ width: '100%', background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: 16, padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                {[
                  { Icon: Package, text: 'Plan & billing at a glance' },
                  { Icon: HardDrive, text: 'Devices & connection type' },
                  { Icon: Receipt, text: 'Recent invoices & payments' },
                ].map(item => (
                  <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.76rem', color: '#475569', fontWeight: 600 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, background: '#fff', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}><item.Icon size={14} strokeWidth={2} /></span>
                    {item.text}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600, background: '#fff', border: '1px solid #F1F5F9', padding: '6px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={12} strokeWidth={2} color="#94A3B8" /> Tip: Context loads instantly when you open a chat</div>
            </div>
          ) : (
            <>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid #F1F5F9', background: 'linear-gradient(135deg,#F8FAFC 0%, #FFFFFF 100%)', position: 'sticky', top: 0, zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg,#F15925 0%, #FF8A4C 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                    <Users size={16} strokeWidth={2} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: '0.88rem', color: 'var(--text-dark)', letterSpacing: '-0.2px' }}>Customer Context</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{session.customerEmail}</div>
                  </div>
                  <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: session.subscriber ? '#16A34A' : '#F59E0B' }} title={session.subscriber ? 'Linked' : 'No subscriber'} />
                </div>
              </div>
              {session.subscriber ? (
                <div style={{ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14, background: '#fff' }}>
                  <div style={{ background: 'linear-gradient(135deg,#FFF7ED 0%, #FFFFFF 60%, #EFF6FF 100%)', border: '1px solid #FFE7D6', borderRadius: 16, padding: '14px 14px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: -18, right: -18, width: 70, height: 70, borderRadius: '50%', background: 'rgba(241,89,37,0.08)' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#fff', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F15925' }}>
                        <Package size={12} strokeWidth={2} />
                      </span>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#9A3412' }}>Subscription</span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.66rem', fontWeight: 800, padding: '3px 8px', borderRadius: 20, background: session.subscriber.status === 'ACTIVE' ? '#DCFCE7' : '#FEE2E2', color: session.subscriber.status === 'ACTIVE' ? '#166534' : '#991B1B', border: '1px solid ' + (session.subscriber.status === 'ACTIVE' ? '#BBF7D0' : '#FECACA') }}>{session.subscriber.status}</span>
                    </div>
                    {session.subscriber.subscriptions[0] ? (
                      <>
                        <div style={{ fontWeight: 900, fontSize: '0.96rem', color: 'var(--text-dark)', letterSpacing: '-0.2px' }}>{session.subscriber.subscriptions[0].plan.name}</div>
                        <div style={{ fontSize: '0.74rem', color: '#475569', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ background: '#fff', border: '1px solid #E2E8F0', padding: '3px 8px', borderRadius: 20, fontWeight: 700 }}>{session.subscriber.subscriptions[0].plan.speedMbps ?? '—'} Mbps</span>
                          <span style={{ background: '#fff', border: '1px solid #E2E8F0', padding: '3px 8px', borderRadius: 20, fontWeight: 700 }}>{fmtKobo(session.subscriber.subscriptions[0].plan.priceKobo)}/mo</span>
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: session.subscriber.subscriptions[0].plan.technology ? '#16A34A' : '#94A3B8' }} />
                          {session.subscriber.subscriptions[0].plan.technology ?? '—'} {session.subscriber.subscriptions[0].plan.staticIp ? '• Static IP' : ''}
                        </div>
                      </>
                    ) : <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No active plan</div>}
                    {session.subscriber.address && <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 10, background: '#fff', border: '1px solid #F1F5F9', borderRadius: 10, padding: '7px 9px', display: 'flex', gap: 6, alignItems: 'flex-start' }}><MapPin size={12} strokeWidth={2} style={{ marginTop: 2, flexShrink: 0, color: '#94A3B8' }} /> <span style={{ lineHeight: 1.4 }}>{session.subscriber.address}</span></div>}
                    <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                      <a href={`mailto:${session.customerEmail}`} style={{ flex: 1, textAlign: 'center', padding: '7px 10px', borderRadius: 20, background: '#fff', border: '1px solid #E2E8F0', fontSize: '0.72rem', fontWeight: 700, color: '#334155', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <Mail size={12} strokeWidth={2} />
                        Email
                      </a>
                      {session.subscriber.user.phone && <a href={`tel:${session.subscriber.user.phone}`} style={{ flex: 1, textAlign: 'center', padding: '7px 10px', borderRadius: 20, background: 'linear-gradient(135deg,#F15925 0%, #EA4B1B 100%)', border: '1px solid #F15925', fontSize: '0.72rem', fontWeight: 700, color: '#fff', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><Phone size={12} strokeWidth={2} /> Call</a>}
                    </div>
                  </div>

                  <div style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 16, padding: '12px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><HardDrive size={12} strokeWidth={2} /></span>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#1E40AF' }}>Devices ({session.subscriber.devices.length})</span>
                    </div>
                    {session.subscriber.devices.length === 0
                      ? <div style={{ fontSize: '0.76rem', color: '#94A3B8', background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: 12, padding: '10px 12px', textAlign: 'center' }}>No devices yet</div>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {session.subscriber.devices.map(d => (
                          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 10px', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 12 }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.status === 'ACTIVE' ? '#16A34A' : '#94A3B8' }} />
                                {d.name || d.connectionType}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: '#64748B', marginTop: 1 }}>{d.connectionType} • {d.status}</div>
                            </div>
                            <span style={{ fontSize: '0.7rem', color: '#334155', fontWeight: 600, background: '#fff', border: '1px solid #E2E8F0', padding: '4px 8px', borderRadius: 20 }}>{d.ipAddress || d.macAddress || '—'}</span>
                          </div>
                        ))}
                      </div>}
                  </div>

                  <div style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 16, padding: '12px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#F0FDF4', color: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Receipt size={12} strokeWidth={2} /></span>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#15803D' }}>Recent invoices</span>
                    </div>
                    {session.subscriber.invoices.length === 0
                      ? <div style={{ fontSize: '0.76rem', color: '#94A3B8', background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: 12, padding: '10px 12px', textAlign: 'center' }}>No invoices</div>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {session.subscriber.invoices.map(i => (
                          <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 12 }}>
                            <span style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--text-dark)' }}>{i.invoiceNumber}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, background: i.status === 'PAID' ? '#DCFCE7' : i.status === 'OVERDUE' ? '#FEE2E2' : '#F1F5F9', color: i.status === 'PAID' ? '#166534' : i.status === 'OVERDUE' ? '#991B1B' : '#64748B', padding: '2px 7px', borderRadius: 20 }}>{i.status}</span>
                              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155' }}>{fmtKobo(i.amountKobo)}</span>
                            </span>
                          </div>
                        ))}
                      </div>}
                  </div>

                  <div style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 16, padding: '12px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#FFF7ED', color: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><TicketIconLucide size={12} strokeWidth={2} /></span>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#92400E' }}>Related Tickets</span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.66rem', fontWeight: 700, color: '#94A3B8', background: '#F8FAFC', padding: '2px 7px', borderRadius: 20, border: '1px solid #F1F5F9' }}>{session.tickets.length}</span>
                    </div>
                    {session.tickets.length === 0
                      ? <div style={{ fontSize: '0.76rem', color: '#94A3B8', background: '#F8FAFC', border: '1px dashed #E2E8F0', borderRadius: 12, padding: '10px 12px', textAlign: 'center' }}>No tickets linked</div>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {session.tickets.map(t => (
                          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#FFFBEB', border: '1px solid #FFF7ED', borderRadius: 12, gap: 8 }}>
                            <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                            <Pill status={t.status} map={statusColors} />
                          </div>
                        ))}
                      </div>}
                  </div>

                  {session.csat !== null && (
                    <div style={{ background: 'linear-gradient(135deg,#FFFBEB 0%, #FFF7ED 100%)', border: '1px solid #FDE68A', borderRadius: 16, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#92400E' }}>Chat rating</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>{[1, 2, 3, 4, 5].map(n => <Star key={n} filled={n <= session.csat!} />)}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#92400E', background: '#fff', padding: '2px 8px', borderRadius: 20, border: '1px solid #FDE68A' }}>{session.csat}/5</span>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ padding: '18px 18px', textAlign: 'center' }}>
                  <div style={{ background: '#FFFBEB', border: '1px dashed #FDE68A', borderRadius: 16, padding: '16px 14px' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.84rem', color: '#92400E' }}>No linked subscriber</div>
                    <div style={{ fontSize: '0.74rem', color: '#B45309', marginTop: 4, lineHeight: 1.5 }}>This chat isn’t tied to a subscriber account yet. Ask for their email or phone to link.</div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* convert-to-ticket modal */}
        {convertOpen && session && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={() => setConvertOpen(false)}>
            <div className="data-card" style={{ width: 460, maxWidth: '94vw', padding: 22, borderRadius: 20, boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid #FFE7D6' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 12, background: 'linear-gradient(135deg,#F15925 0%, #FF8A4C 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <TicketIconLucide size={18} strokeWidth={2} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: 'var(--text-dark)' }}>Convert chat to ticket</h3>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Keep the context — create a trackable ticket</div>
                </div>
                <button onClick={() => setConvertOpen(false)} style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} strokeWidth={2} /></button>
              </div>
              <label style={labelStyle}>Subject</label>
              <input value={convertSubject} onChange={e => setConvertSubject(e.target.value)} placeholder={`Chat: ${session.customerName || 'Support request'}`} style={{ ...inputStyle, marginBottom: 16, borderRadius: 12, padding: '11px 14px', border: '1px solid #E2E8F0' }} autoFocus />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setConvertOpen(false)} style={{ padding: '9px 16px', borderRadius: 20, border: '1px solid #E2E8F0', background: '#fff', fontSize: '0.82rem', fontWeight: 700, color: '#64748B', cursor: 'pointer' }}>Cancel</button>
                <button onClick={convertToTicket} disabled={!convertSubject.trim()} style={{ padding: '9px 18px', borderRadius: 20, border: 'none', background: !convertSubject.trim() ? '#F1F5F9' : 'linear-gradient(135deg,#F15925 0%, #EA4B1B 100%)', color: !convertSubject.trim() ? '#94A3B8' : '#fff', fontSize: '0.82rem', fontWeight: 800, cursor: !convertSubject.trim() ? 'not-allowed' : 'pointer', boxShadow: !convertSubject.trim() ? 'none' : '0 4px 14px rgba(241,89,37,0.3)' }}>Create Ticket</button>
              </div>
            </div>
          </div>
        )}
      </div>
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
      <div className="data-card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: '1 1 220px', width: 'auto' }}>
            <Search size={16} strokeWidth={2} color="var(--text-muted)" />
            <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} placeholder="Search subject or email…" />
          </div>
          <select value={status} onChange={e => { setStatus(e.target.value); setTimeout(load, 0); }} style={pillSelect}>
            <option value="">All statuses</option>
            {Object.keys(statusColors).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={priority} onChange={e => { setPriority(e.target.value); setTimeout(load, 0); }} style={pillSelect}>
            <option value="">All priorities</option>
            {Object.keys(priorityColors).map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={() => setCreateOpen(true)} className="btn-primary" style={{ marginLeft: 'auto' }}>
            <Plus size={16} strokeWidth={2} />
            New Ticket
          </button>
        </div>
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
          <div className="data-card" style={{ width: 560, maxWidth: '94vw', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: '24px 0 0 24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{detail.subject}</h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {detail.subscriber?.user.email}{detail.subscriber?.user.phone ? ' · ' + detail.subscriber?.user.phone : ''} · opened {timeAgo(detail.createdAt)}
                  </div>
                  {detail.sourceChatSession && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>From chat session · {detail.sourceChatSession.status}</div>}
                </div>
                <button onClick={() => setDetailId(null)} className="btn-sm-outline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} strokeWidth={2} /></button>
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
                      <button onClick={() => setTicketFiles(files => files.filter(x => x.id !== f.id))} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700, padding: 0, display: 'flex', alignItems: 'center' }}><X size={12} strokeWidth={2.5} /></button>
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
          <div className="data-card" style={{ width: 500, maxWidth: '94vw', padding: 24, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
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
            <div className="grid-2" style={{ gap: 12, marginBottom: 12 }}>
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
  const [search, setSearch] = useState('');

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

  const filtered = items.filter(c =>
    c.title.toLowerCase().includes(search.toLowerCase()) ||
    (c.category ?? '').toLowerCase().includes(search.toLowerCase()) ||
    c.body.toLowerCase().includes(search.toLowerCase())
  );

  function openEditor(c: Canned) {
    setEditId(c.id);
    setForm({ title: c.title, body: c.body, category: c.category ?? '' });
  }

  return (
    <div className="grid-sidebar">
      <div className="data-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: '1 1 200px', width: 'auto' }}>
            <Search size={16} strokeWidth={2} color="var(--text-muted)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates…" />
          </div>
          <button onClick={() => { resetForm(); setEditId('new'); }} className="btn-primary" style={{ marginLeft: 'auto' }}>
            <Plus size={15} strokeWidth={2} />
            New
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 40, color: 'var(--text-muted)' }}>
              <Zap size={28} strokeWidth={1.5} style={{ opacity: 0.45 }} />
              <span style={{ fontSize: '0.85rem' }}>{search ? 'No templates match your search' : 'No canned responses yet'}</span>
            </div>
          ) : filtered.map(c => {
            const active = editId === c.id;
            return (
              <div key={c.id} onClick={() => openEditor(c)}
                style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', background: active ? 'var(--primary-light)' : 'transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                  {c.category && (
                    <span style={{ flexShrink: 0, padding: '2px 9px', borderRadius: 10, background: '#EFF6FF', color: '#2563EB', fontSize: '0.68rem', fontWeight: 600 }}>{c.category}</span>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.body}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Used {c.usageCount}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>· Updated {timeAgo(c.updatedAt)}</span>
                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                    <button onClick={e => { e.stopPropagation(); openEditor(c); }} className="btn-sm-outline" style={{ padding: '3px 10px' }}>Edit</button>
                    <button onClick={e => { e.stopPropagation(); remove(c.id); }} className="btn-sm-outline" style={{ padding: '3px 10px', color: '#DC2626', borderColor: '#FECACA' }}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="data-card" style={{ padding: 20, alignSelf: 'start' }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>{editId === 'new' ? 'New template' : editId ? 'Edit template' : 'Template editor'}</div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>
          {editId ? 'Reusable reply agents can drop into live chats.' : 'Select a template to edit, or create a new one.'}
        </p>
        {editId !== null ? (
          <>
            <label style={labelStyle}>Title</label>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Billing receipt pointer" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={labelStyle}>Category</label>
            <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Billing / Technical / Sales" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={labelStyle}>Body</label>
            <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={7} placeholder="Response template…" style={{ ...inputStyle, resize: 'vertical', marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={resetForm} className="btn-outline">Cancel</button>
              <button onClick={save} className="btn-primary" style={{ marginLeft: 'auto' }} disabled={!form.title.trim() || !form.body.trim()}>Save</button>
            </div>
          </>
        ) : (
          <button onClick={() => setEditId('new')} className="btn-primary">+ New template</button>
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
    { label: 'Chats Handled', value: data.totals.chatsHandled, color: '#F15925', icon: <MessageCircle size={20} strokeWidth={2} /> },
    { label: 'Closed Chats', value: data.totals.closedChats, color: '#16A34A', icon: <CheckCircle size={20} strokeWidth={2} /> },
    { label: 'Tickets Resolved', value: data.totals.ticketsResolved, color: '#2563EB', icon: <TicketIconLucide size={20} strokeWidth={2} /> },
    { label: 'Avg CSAT', value: data.totals.avgCsat ? `${data.totals.avgCsat}` : '—', color: '#F59E0B', icon: <StarLucide size={20} strokeWidth={2} /> },
  ];

  const maxHandled = Math.max(...data.agents.map(a => a.chatsHandled), 1);
  const presenceColor = (p: string) => (p === 'ONLINE' ? '#16A34A' : p === 'AWAY' ? '#CA8A04' : '#94A3B8');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="badge-tabs">
          {(['today', 'week', 'month'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)} className={`tab-item ${range === r ? 'active' : ''}`} style={{ border: 'none', background: 'transparent', textTransform: 'capitalize', fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>{r}</button>
          ))}
        </div>
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', background: '#fff', border: '1px solid var(--border-color)', padding: '5px 12px', borderRadius: 20 }}>
          Since {new Date(data.since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="grid-4">
        {cards.map(c => (
          <div key={c.label} className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${c.color}14`, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {c.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{c.label}</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 700, color: c.color, whiteSpace: 'nowrap' }}>{c.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Chats handled by agent</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{data.agents.length} agent{data.agents.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.agents.map(a => (
            <div key={a.agentId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={a.name || a.email} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {a.role.replace(/_/g, ' ')}</span>
                  </span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: a.chatsHandled > 0 ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }}>{a.chatsHandled}</span>
                </div>
                <div style={{ height: 7, background: '#F1F5F9', borderRadius: 6 }}>
                  <div style={{ height: 7, width: `${Math.max((a.chatsHandled / maxHandled) * 100, 2)}%`, background: 'var(--primary)', borderRadius: 6 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="data-card">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', fontWeight: 700, fontSize: '0.95rem' }}>Agent performance</div>
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
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={a.name || a.email} size={30} />
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{a.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>{a.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, color: presenceColor(a.presence), whiteSpace: 'nowrap' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: presenceColor(a.presence) }} />
                      {a.presence}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{a.chatsHandled}</td>
                  <td>{a.closedChats}</td>
                  <td>{a.resolutionRate}%</td>
                  <td>{fmtDur(a.avgFirstResponseSec)}</td>
                  <td>{fmtDur(a.avgDurationSec)}</td>
                  <td>{a.avgCsat > 0 ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{a.avgCsat} <StarLucide size={12} strokeWidth={2} fill="#F59E0B" color="#F59E0B" /></span> : '—'}</td>
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
