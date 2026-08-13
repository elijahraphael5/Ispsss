import { SkeletonBlock, SkeletonTable } from '../../components/Skeleton';

export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SkeletonBlock width={200} height={28} />
        <SkeletonBlock width={130} height={38} borderRadius={20} />
      </div>
      <div className="data-card" style={{ padding: 24 }}>
        <SkeletonTable rows={10} cols={5} />
      </div>
    </div>
  );
}
