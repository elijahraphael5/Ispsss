// Mock data for the signed-in subscriber. Shaped like Subscriber/Subscription/
// Invoice/Ticket/Cpe models in apps/api/prisma/schema.prisma.

export const currentSubscriber = {
  name: "Adaeze Okonkwo",
  accountId: "SUB-10231",
  plan: {
    name: "Fiber 50Mbps",
    speedMbps: 50,
    dataCapGb: null as number | null, // unlimited
    priceKobo: 15_000_00,
    renewsOn: "2026-08-14",
    autoRenew: true,
  },
  usage: {
    usedGb: 312,
    // null cap = unlimited; UI shows cycle-progress + consumption instead of a "data left" ring
    cycleDaysTotal: 30,
    cycleDaysElapsed: 20,
    peakMbps: 47,
    dailyGb: [8, 11, 9, 14, 12, 10, 13],
  },
  devices: [
    { name: "Living Room ONT", status: "ONLINE", ip: "10.44.2.18" },
    { name: "Office Wi-Fi Extender", status: "ONLINE", ip: "10.44.2.19" },
  ],
  network: { signalStrength: 92, latencyMs: 14, status: "ONLINE" as const },
};

export const invoices = [
  { id: "INV-88233", amountKobo: 15_000_00, status: "PAID", issuedAt: "2026-06-15", paidAt: "2026-06-16" },
  { id: "INV-88198", amountKobo: 15_000_00, status: "PAID", issuedAt: "2026-05-15", paidAt: "2026-05-15" },
  { id: "INV-88121", amountKobo: 15_000_00, status: "PAID", issuedAt: "2026-04-15", paidAt: "2026-04-17" },
  { id: "INV-88345", amountKobo: 15_000_00, status: "ISSUED", issuedAt: "2026-07-15", paidAt: null },
];

export const tickets = [
  { id: "TCK-5525", subject: "Router replacement needed", status: "RESOLVED", updatedAt: "2026-07-10" },
  { id: "TCK-5410", subject: "Slow speed in the evenings", status: "CLOSED", updatedAt: "2026-06-02" },
];
