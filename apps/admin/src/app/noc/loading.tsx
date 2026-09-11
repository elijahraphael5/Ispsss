import { SkeletonBlock, SkeletonCard, SkeletonTable } from '../../components/Skeleton';

export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={200} height={28} />
      <div className="grid-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={90} />)}
      </div>
      <div className="data-card" style={{ padding: 24 }}>
        <SkeletonTable rows={8} cols={5} />
      </div>
    </div>
  );
}
