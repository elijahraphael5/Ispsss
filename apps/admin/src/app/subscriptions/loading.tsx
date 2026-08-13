import { SkeletonBlock, SkeletonTable } from '../../components/Skeleton';

export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={200} height={28} />
      <div className="data-card" style={{ padding: 24 }}>
        <SkeletonTable rows={8} cols={5} />
      </div>
    </div>
  );
}
