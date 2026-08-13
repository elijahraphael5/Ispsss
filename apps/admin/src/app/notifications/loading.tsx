import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';

export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={200} height={28} />
      <SkeletonBlock width={320} height={14} />
      <div style={{ display: 'flex', gap: 8 }}>
        <SkeletonBlock width={120} height={34} borderRadius={20} />
        <SkeletonBlock width={120} height={34} borderRadius={20} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height={80} />)}
      </div>
    </div>
  );
}
