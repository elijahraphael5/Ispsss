import { SkeletonBlock, SkeletonTable } from '../../components/Skeleton';

export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <SkeletonBlock width={200} height={28} />
          <div style={{ display: 'flex', gap: 8 }}>
            <SkeletonBlock width={140} height={36} borderRadius={20} />
            <SkeletonBlock width={140} height={36} borderRadius={20} />
            <SkeletonBlock width={100} height={36} borderRadius={20} />
          </div>
        </div>
        <SkeletonTable rows={10} cols={5} />
      </div>
    </div>
  );
}
