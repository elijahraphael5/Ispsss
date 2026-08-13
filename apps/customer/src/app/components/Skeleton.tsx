export function SkeletonBlock({ width, height, borderRadius = 16 }: { width?: number | string; height?: number | string; borderRadius?: number }) {
  return (
    <div
      style={{
        width: width ?? '100%',
        height: height ?? 20,
        borderRadius,
        background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s ease-in-out infinite',
      }}
    />
  );
}

export function SkeletonCard({ height = 100 }: { height?: number }) {
  return <div className="data-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, height }} />;
}

export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 12 }}>
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonBlock key={c} height={16} width={`${100 / cols}%`} borderRadius={6} />
          ))}
        </div>
      ))}
    </div>
  );
}
