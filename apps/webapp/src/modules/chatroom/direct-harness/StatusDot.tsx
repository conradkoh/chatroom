import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionStatus = 'pending' | 'spawning' | 'active' | 'idle' | 'closed' | 'failed';

const STATUS_STYLES: Record<SessionStatus, { color: string; label: string }> = {
  pending: { color: 'bg-amber-500 dark:bg-amber-400', label: 'Pending' },
  spawning: { color: 'bg-amber-500 dark:bg-amber-400 animate-pulse', label: 'Spawning' },
  active: { color: 'bg-emerald-500 dark:bg-emerald-400', label: 'Active' },
  idle: { color: 'bg-slate-400 dark:bg-slate-500', label: 'Idle' },
  closed: { color: 'bg-slate-400 dark:bg-slate-600', label: 'Closed' },
  failed: { color: 'bg-red-500 dark:bg-red-400', label: 'Failed' },
};

// ─── StatusDot ────────────────────────────────────────────────────────────────

interface StatusDotProps {
  status: SessionStatus;
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
  const { color, label } = STATUS_STYLES[status];
  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full shrink-0', color, className)}
      title={label}
      aria-label={label}
    />
  );
}
