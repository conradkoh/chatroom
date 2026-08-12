import { Skeleton } from '@/components/ui/skeleton';

export function LogLoadingSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1 p-3" aria-busy="true" aria-label="Loading logs">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3 py-1">
          <Skeleton className="h-4 w-16 shrink-0" />
          <Skeleton className="h-4 w-12 shrink-0" />
          <Skeleton className="h-4 w-24 shrink-0" />
          <Skeleton className="h-4 min-w-0 flex-1" />
        </div>
      ))}
    </div>
  );
}
