export default function MockBanner() {
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FEF3C7', border: '1px solid #FCD34D',
      color: '#92400E', padding: '12px 16px', borderRadius: 12, marginBottom: 20, fontSize: '0.82rem', lineHeight: 1.5,
    }}>
      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>MOCK MODE</span>
      <span>
        Mock mode — no real RADIUS/router calls made. All data is in-memory and resets on reload.
        Swap <code>mockApi</code> for <code>realApi</code> in <code>page.tsx</code> to point this UI at radius-service.
      </span>
    </div>
  );
}
