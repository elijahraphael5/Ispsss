// Mock data shaped exactly like apps/api/prisma/schema.prisma models.
// Swap for real fetches to /api/v1/* once auth module is live.

export type DeviceStatus = "ONLINE" | "OFFLINE" | "WARNING" | "CRITICAL";
export type SubscriberStatus = "ACTIVE" | "SUSPENDED" | "PENDING_KYC" | "TERMINATED";
export type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "ESCALATED" | "RESOLVED" | "CLOSED";

export const kpis = {
  activeCustomers: 8412,
  onlineNow: 7903,
  revenueToday: 184_200_00,
  revenueMonth: 41_760_500_00,
  suspendedAccounts: 214,
  openTickets: 37,
  networkHealthPct: 98.6,
  bandwidthMbps: 41230,
};

export const subscribers = [
  { id: "SUB-10231", name: "Adaeze Okonkwo", type: "RESIDENTIAL", plan: "Fiber 50Mbps", branch: "Lekki", status: "ACTIVE" as SubscriberStatus, balanceKobo: 0 },
  { id: "SUB-10232", name: "Chukwuemeka Umeh", type: "BUSINESS", plan: "Corporate 200Mbps", branch: "Victoria Island", status: "ACTIVE" as SubscriberStatus, balanceKobo: -1250000 },
  { id: "SUB-10233", name: "Fatima Bello", type: "RESIDENTIAL", plan: "Fiber 25Mbps", branch: "Ikeja", status: "SUSPENDED" as SubscriberStatus, balanceKobo: -890000 },
  { id: "SUB-10234", name: "Tunde Adisa", type: "RESIDENTIAL", plan: "Fiber 100Mbps", branch: "Lekki", status: "PENDING_KYC" as SubscriberStatus, balanceKobo: 0 },
  { id: "SUB-10235", name: "Ngozi Eze Enterprises", type: "ENTERPRISE", plan: "Enterprise 1Gbps", branch: "Ikoyi", status: "ACTIVE" as SubscriberStatus, balanceKobo: 0 },
  { id: "SUB-10236", name: "Ibrahim Sule", type: "RESIDENTIAL", plan: "Fiber 50Mbps", branch: "Ikeja", status: "ACTIVE" as SubscriberStatus, balanceKobo: 0 },
  { id: "SUB-10237", name: "Blessing Okafor", type: "BUSINESS", plan: "Corporate 100Mbps", branch: "Victoria Island", status: "TERMINATED" as SubscriberStatus, balanceKobo: 0 },
];

export const networkDevices = [
  { id: "RTR-01", name: "Core Router — Lekki", type: "router", status: "ONLINE" as DeviceStatus },
  { id: "RTR-02", name: "Core Router — Ikeja", type: "router", status: "ONLINE" as DeviceStatus },
  { id: "SW-11", name: "Dist. Switch — VI Block A", type: "switch", status: "WARNING" as DeviceStatus },
  { id: "OLT-04", name: "GPON OLT — Ikoyi", type: "olt", status: "ONLINE" as DeviceStatus },
  { id: "OLT-05", name: "GPON OLT — Lekki Phase 1", type: "olt", status: "CRITICAL" as DeviceStatus },
  { id: "AP-22", name: "Access Point — Ajah", type: "ap", status: "ONLINE" as DeviceStatus },
  { id: "SW-12", name: "Dist. Switch — Ikeja GRA", type: "switch", status: "OFFLINE" as DeviceStatus },
  { id: "RTR-03", name: "Core Router — VI", type: "router", status: "ONLINE" as DeviceStatus },
];

export const tickets = [
  { id: "TCK-5521", subject: "No connectivity since 6am", subscriber: "Fatima Bello", priority: "CRITICAL" as TicketPriority, status: "ESCALATED" as TicketStatus, sla: "23m left" },
  { id: "TCK-5522", subject: "Slow speed on Corporate 200Mbps", subscriber: "Chukwuemeka Umeh", priority: "HIGH" as TicketPriority, status: "IN_PROGRESS" as TicketStatus, sla: "1h 40m left" },
  { id: "TCK-5523", subject: "Request static IP", subscriber: "Ngozi Eze Enterprises", priority: "LOW" as TicketPriority, status: "OPEN" as TicketStatus, sla: "1d left" },
  { id: "TCK-5524", subject: "Billing discrepancy on last invoice", subscriber: "Ibrahim Sule", priority: "MEDIUM" as TicketPriority, status: "OPEN" as TicketStatus, sla: "5h left" },
  { id: "TCK-5525", subject: "Router replacement needed", subscriber: "Adaeze Okonkwo", priority: "MEDIUM" as TicketPriority, status: "RESOLVED" as TicketStatus, sla: "closed" },
];

export const invoices = [
  { id: "INV-88231", subscriber: "Chukwuemeka Umeh", amountKobo: 12_500_00, status: "OVERDUE", dueAt: "2026-07-05" },
  { id: "INV-88232", subscriber: "Fatima Bello", amountKobo: 8_900_00, status: "OVERDUE", dueAt: "2026-07-10" },
  { id: "INV-88233", subscriber: "Adaeze Okonkwo", amountKobo: 15_000_00, status: "PAID", dueAt: "2026-07-15" },
  { id: "INV-88234", subscriber: "Ngozi Eze Enterprises", amountKobo: 450_000_00, status: "ISSUED", dueAt: "2026-07-28" },
  { id: "INV-88235", subscriber: "Ibrahim Sule", amountKobo: 15_000_00, status: "ISSUED", dueAt: "2026-07-30" },
];

export const revenueTrend = [32, 34, 31, 38, 40, 37, 42, 44, 41, 45, 48, 46];
