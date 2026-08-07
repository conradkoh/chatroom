import { Skeleton } from '@/components/ui/skeleton';

type AdminListSkeletonProps = {
  count?: number;
  itemClassName?: string;
};

export function AdminListSkeleton({
  count = 3,
  itemClassName = 'h-16 w-full',
}: AdminListSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={itemClassName} />
      ))}
    </div>
  );
}
