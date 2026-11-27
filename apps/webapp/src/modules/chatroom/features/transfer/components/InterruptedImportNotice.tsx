'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';

import {
  useRecoverInterruptedImport,
  type RecoverState,
} from '../hooks/useRecoverInterruptedImport';

import { InlineFeedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface InterruptedImportNoticeProps {
  className?: string;
}

/**
 * The leftover record of an import whose tab closed or reloaded. It only appears
 * once the record's heartbeat is stale, so a live import in another tab is never
 * offered for removal.
 */
export function InterruptedImportNotice({ className }: InterruptedImportNoticeProps = {}) {
  const { pending, state, remove, dismiss } = useRecoverInterruptedImport();
  if (pending === null && state === 'idle') return null;

  return (
    <div
      data-testid="interrupted-import-notice"
      role="status"
      className={cn(
        'mx-2 my-2 flex items-start gap-2 border border-chatroom-status-warning/40 bg-chatroom-status-warning/10 p-3 text-xs',
        className
      )}
    >
      <AlertTriangle
        size={14}
        className="mt-0.5 shrink-0 text-chatroom-status-warning"
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-bold">An import was interrupted</p>
        <p className="text-chatroom-text-muted">
          A chatroom was being imported when this tab was closed or reloaded and may be incomplete.
        </p>
        <NoticeActions pending={pending !== null} state={state} remove={remove} dismiss={dismiss} />
      </div>
    </div>
  );
}

// fallow-ignore-next-line complexity
function NoticeActions({
  pending,
  state,
  remove,
  dismiss,
}: {
  pending: boolean;
  state: RecoverState;
  remove(): Promise<void>;
  dismiss(): void;
}) {
  if (state === 'rollingBack') {
    return (
      <p className="flex items-center gap-2 text-chatroom-text-muted">
        <Loader2 className="animate-spin" size={12} aria-hidden />
        Removing…
      </p>
    );
  }
  if (state === 'removed') {
    return (
      <div className="space-y-2">
        <p className="text-chatroom-text-muted">Removed the incomplete chatroom.</p>
        <Button size="xs" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    );
  }
  if (typeof state === 'object') {
    return (
      <div className="space-y-2">
        <InlineFeedback
          feedback={{
            id: 1,
            tone: 'error',
            message: `Could not remove it: ${state.failed}.`,
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" onClick={() => void remove()}>
            Remove incomplete chatroom
          </Button>
          <Button size="xs" variant="ghost" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }
  if (!pending) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs" variant="outline" onClick={() => void remove()}>
        Remove incomplete chatroom
      </Button>
      <Button size="xs" variant="ghost" onClick={dismiss}>
        Keep it
      </Button>
    </div>
  );
}
