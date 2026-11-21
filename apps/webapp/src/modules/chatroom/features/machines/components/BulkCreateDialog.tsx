'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useRef, useState, type ReactElement, type RefObject } from 'react';
import { toast } from 'sonner';

import { LedgerNotice } from './LedgerNotice';
import { useBulkCreateChatrooms } from '../hooks/useBulkCreateChatrooms';
import {
  EMPTY_BULK_TOTALS,
  addBulkResult,
  chatroomCount,
  planBulkCreate,
  repositoryCount,
  type BulkCreateTotals,
} from '../lib/bulkCreate';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { chatroomIndustrialButtonPrimaryClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';

const SECTION_HEADING_CLASS =
  'text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted';

const WHOLE_CALL_ERROR_COPY =
  'Nothing was created. It is safe to try again — repositories that already have a chatroom are skipped.';

export interface BulkCreateDialogProps {
  machineId: string;
  displayName: string;
  /** Working dirs to create, in list order, captured when the dialog opened. */
  paths: readonly string[];
  /** Called once the dialog has closed. The parent unmounts the dialog and refocuses its trigger. */
  onClose: () => void;
}

type Phase = 'confirm' | 'pending' | 'summary' | 'error';

/** `Created 3 · Skipped 1 · Failed 2`. */
function statsLine(totals: BulkCreateTotals): string {
  return `Created ${totals.created} · Skipped ${totals.skipped} · Failed ${totals.failed}`;
}

/** `1 already had a chatroom` / `N already had a chatroom`. */
function skippedLine(count: number): string {
  return count === 1 ? '1 already had a chatroom' : `${count} already had a chatroom`;
}

/** `1 repository still has no chatroom.` / `N repositories still have no chatroom.` */
function remainingLine(count: number): string {
  return count === 1
    ? '1 repository still has no chatroom.'
    : `${count} repositories still have no chatroom.`;
}

/** Explains the per-call cap on the first call of a large run. */
function overLimitNote(batch: number, total: number): string {
  return `${batch} of ${total} repositories will be created now. You can create the next ${
    total - batch
  } afterwards.`;
}

/** True once any call has finished, so the dialog has something to announce on close. */
function hasProcessed(totals: BulkCreateTotals): boolean {
  return totals.created + totals.skipped + totals.failed > 0;
}

/** Which toast the closed dialog owes the user, if any. */
function announceKind(totals: BulkCreateTotals): 'none' | 'success' | 'error' | 'info' {
  if (totals.created > 0) return 'success';
  if (totals.failed > 0) return 'error';
  if (totals.skipped > 0) return 'info';
  return 'none';
}

/** Toasts a cumulative summary, and nothing at all when no call finished. */
function announceBulkTotals(totals: BulkCreateTotals): void {
  const kind = announceKind(totals);
  if (kind === 'success') toast.success(`Created ${chatroomCount(totals.created)}`);
  if (kind === 'error') toast.error(`No chatrooms created. ${totals.failed} failed.`);
  if (kind === 'info') toast(`${totals.skipped} already had a chatroom`);
}

function ConfirmBody({
  displayName,
  batch,
  total,
  offset,
  primaryRef,
  onConfirm,
}: {
  displayName: string;
  batch: string[];
  total: number;
  offset: number;
  primaryRef: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Create chatrooms for {repositoryCount(batch.length)}?</AlertDialogTitle>
        <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
          <p>
            Creates one chatroom per repository on “{displayName}” using the default team. No agents
            are started. Repositories that already have a chatroom are skipped.
          </p>
          {total > batch.length && offset === 0 && <p>{overLimitNote(batch.length, total)}</p>}
          <ul
            data-testid="bulk-create-paths"
            className="max-h-40 overflow-y-auto border border-chatroom-border bg-chatroom-bg-tertiary font-mono text-[10px]"
          >
            {batch.map((path) => (
              <li key={path} data-testid="bulk-create-path" className="truncate px-2 py-1">
                {path}
              </li>
            ))}
          </ul>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          ref={primaryRef}
          data-testid="bulk-create-confirm"
          variant="default"
          className={chatroomIndustrialButtonPrimaryClassName}
          onClick={(e) => {
            // Keep the dialog open: the call decides between the next batch and a summary.
            e.preventDefault();
            e.preventBaseUIHandler();
            onConfirm();
          }}
        >
          Create {chatroomCount(batch.length)}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

function PendingBody({ count }: { count: number }) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Creating chatrooms…</AlertDialogTitle>
        <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
          <p
            data-testid="bulk-create-pending"
            className="flex items-center gap-2 text-xs text-chatroom-text-primary"
          >
            <Loader2 className="animate-spin" size={14} aria-hidden />
            Creating {chatroomCount(count)}…
          </p>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled>Cancel</AlertDialogCancel>
        <AlertDialogAction
          disabled
          variant="default"
          className={chatroomIndustrialButtonPrimaryClassName}
        >
          <Loader2 className="animate-spin" size={14} aria-hidden />
          Creating…
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

function FailuresBlock({ totals }: { totals: BulkCreateTotals }) {
  if (totals.failed === 0) return null;
  return (
    <div data-testid="bulk-create-failures" className="space-y-2">
      <h3 className={SECTION_HEADING_CLASS}>Failed ({totals.failed})</h3>
      <ul className="max-h-32 space-y-1 overflow-y-auto font-mono text-[10px]">
        {totals.failures.map((failure) => (
          <li key={failure.workingDir}>
            {failure.workingDir} — {failure.reason}
          </li>
        ))}
      </ul>
      <p className="text-xs text-chatroom-text-muted">Rescan to refresh the repository list.</p>
    </div>
  );
}

function SummaryBody({
  totals,
  left,
  nextBatch,
  primaryRef,
  onNext,
}: {
  totals: BulkCreateTotals;
  left: number;
  nextBatch: number;
  primaryRef: RefObject<HTMLButtonElement | null>;
  onNext: () => void;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Bulk create summary</AlertDialogTitle>
        <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
          <p data-testid="bulk-create-summary" className="text-xs text-chatroom-text-primary">
            {statsLine(totals)}
          </p>
          <FailuresBlock totals={totals} />
          {totals.skipped > 0 && <p className="text-xs">{skippedLine(totals.skipped)}</p>}
          {left > 0 && (
            <p data-testid="bulk-create-remaining" className="text-xs text-chatroom-text-primary">
              {remainingLine(left)}
            </p>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Done</AlertDialogCancel>
        {left > 0 && (
          <AlertDialogAction
            ref={primaryRef}
            data-testid="bulk-create-next"
            variant="default"
            className={chatroomIndustrialButtonPrimaryClassName}
            onClick={(e) => {
              // Keep the dialog open: the next batch reports its own outcome.
              e.preventDefault();
              e.preventBaseUIHandler();
              onNext();
            }}
          >
            Create next {nextBatch}
          </AlertDialogAction>
        )}
      </AlertDialogFooter>
    </>
  );
}

function ErrorBody({
  totals,
  primaryRef,
  onRetry,
}: {
  totals: BulkCreateTotals;
  primaryRef: RefObject<HTMLButtonElement | null>;
  onRetry: () => void;
}) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Could not create chatrooms</AlertDialogTitle>
        <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
          <LedgerNotice tone="error" testId="bulk-create-error">
            {WHOLE_CALL_ERROR_COPY}
          </LedgerNotice>
          {hasProcessed(totals) && (
            <p data-testid="bulk-create-earlier" className="text-xs">
              Earlier batches are unchanged: {statsLine(totals)}.
            </p>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Close</AlertDialogCancel>
        <AlertDialogAction
          ref={primaryRef}
          data-testid="bulk-create-retry"
          variant="default"
          className={chatroomIndustrialButtonPrimaryClassName}
          onClick={(e) => {
            // Keep the dialog open: the retry resends the same batch.
            e.preventDefault();
            e.preventBaseUIHandler();
            onRetry();
          }}
        >
          Try again
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Confirm → pending → summary (or error) for one bulk create session.
 *
 * Targets are captured by the parent when the dialog opens, so rows flipping to "Has chatroom"
 * mid-run cannot shrink the plan. Each call sends at most BULK_CREATE_MAX_REPOSITORIES; the
 * offset advances only after a call succeeds, so a whole-call failure retries the same batch.
 */
export function BulkCreateDialog({
  machineId,
  displayName,
  paths,
  onClose,
}: BulkCreateDialogProps) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [offset, setOffset] = useState(0);
  const [totals, setTotals] = useState<BulkCreateTotals>(EMPTY_BULK_TOTALS);
  const { createMany } = useBulkCreateChatrooms();
  const primaryRef = useRef<HTMLButtonElement>(null);

  const plan = planBulkCreate(paths, offset);
  const total = paths.length;
  const left = total - offset;

  const handleClose = useCallback(() => {
    announceBulkTotals(totals);
    onClose();
  }, [totals, onClose]);

  /** One call per click. Success advances the offset; a throw leaves it so a retry resends. */
  const runBatch = useCallback(async () => {
    setPhase('pending');
    try {
      const result = await createMany(machineId, plan.batch);
      setTotals((prev) => addBulkResult(prev, result));
      setOffset((prev) => prev + plan.batch.length);
      setPhase('summary');
    } catch {
      setPhase('error');
    }
  }, [createMany, machineId, plan.batch]);

  const onConfirm = () => void runBatch();
  const bodies: Record<Phase, ReactElement> = {
    confirm: (
      <ConfirmBody
        displayName={displayName}
        batch={plan.batch}
        total={total}
        offset={offset}
        primaryRef={primaryRef}
        onConfirm={onConfirm}
      />
    ),
    pending: <PendingBody count={plan.batch.length} />,
    summary: (
      <SummaryBody
        totals={totals}
        left={left}
        nextBatch={plan.batch.length}
        primaryRef={primaryRef}
        onNext={onConfirm}
      />
    ),
    error: <ErrorBody totals={totals} primaryRef={primaryRef} onRetry={onConfirm} />,
  };

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        // Only confirm, summary, and error can close; a pending call is not dismissable.
        if (!next && phase !== 'pending') handleClose();
      }}
    >
      <AlertDialogContent data-testid="bulk-create-dialog" initialFocus={primaryRef}>
        {bodies[phase]}
      </AlertDialogContent>
    </AlertDialog>
  );
}
