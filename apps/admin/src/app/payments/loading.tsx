import { SkeletonBlock, SkeletonCard, SkeletonTable } from '../../components/Skeleton';

export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SkeletonBlock width={200} height={28} />
        <SkeletonBlock width={130} height={38} borderRadius={20} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={90} />)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} width={110} height={34} borderRadius={20} />)}
      </div>
      <div className="data-card" style={{ padding: 24 }}>
        <SkeletonTable rows={8} cols={6} />
      </div>
    </div>
  );
}
