'use client';

import { ArrowRight, Loader2, Star } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';

import { getCompactModelLabel } from '../../../types/machine';
import type {
  StartFavoriteFailure,
  StartFlowPhase,
  StartWithFavoritesDialogProps,
} from '../hooks/useStartAgentsWithFavorites';
import type { FavoriteMismatch } from '../lib/favoriteStartMismatches';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  chatroomIndustrialButtonPrimaryClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '@/modules/chatroom/components/shared/industrialDialogStyles';

const FOOTER_BUTTON_CLASS = 'w-full sm:w-auto';
const PRIMARY_CLASS = cn(FOOTER_BUTTON_CLASS, chatroomIndustrialButtonPrimaryClassName);
const SECONDARY_CLASS = cn(FOOTER_BUTTON_CLASS, chatroomIndustrialButtonSecondaryClassName);
const EXPLANATION =
  "Use favourites saves them as these agents' configuration, so future starts use them too. Start with current keeps every agent as it is.";

function isBusyPhase(phase: StartFlowPhase): boolean {
  return phase === 'applying' || phase === 'starting';
}

function introCopy(count: number): string {
  return count === 1
    ? '1 agent is not using its top favourite model.'
    : `${count} agents are not using their top favourite models.`;
}

function describeModel(entry: { agentHarness: string; model: string }): string {
  return `${entry.agentHarness} · ${getCompactModelLabel(entry.model)}`;
}

function isSameSlot(mismatch: FavoriteMismatch, failure: StartFavoriteFailure): boolean {
  return mismatch.role === failure.role && mismatch.workspaceLabel === failure.workspaceLabel;
}

/** "a, b now uses ..." style sentence; empty when there are no roles. */
function sentence(roles: string[], one: string, many: string): string {
  if (roles.length === 0) return '';
  return `${roles.join(', ')} ${roles.length === 1 ? one : many}.`;
}

function savedSummary(
  mismatches: readonly FavoriteMismatch[],
  failures: readonly StartFavoriteFailure[]
): string {
  const saved = mismatches
    .filter((mismatch) => !failures.some((failure) => isSameSlot(mismatch, failure)))
    .map((mismatch) => mismatch.role);
  const kept = failures.map((failure) => failure.role);
  return [
    sentence(saved, 'now uses its favourite', 'now use their favourites'),
    sentence(kept, 'keeps its previous configuration', 'keep their previous configuration'),
  ]
    .filter(Boolean)
    .join(' ');
}

function PrimaryLabel({ phase, idle }: { phase: StartFlowPhase; idle: string }) {
  if (phase === 'applying')
    return (
      <>
        <Loader2 size={14} className="mr-1 animate-spin" />
        Applying…
      </>
    );
  if (phase === 'starting')
    return (
      <>
        <Loader2 size={14} className="mr-1 animate-spin" />
        Starting…
      </>
    );
  return idle;
}

function MismatchRow({
  mismatch,
  showWorkspaceLabel,
}: {
  mismatch: FavoriteMismatch;
  showWorkspaceLabel: boolean;
}) {
  return (
    <li
      data-testid="start-favourites-row"
      className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2"
    >
      <span className="font-bold uppercase tracking-wide text-chatroom-text-primary">
        {mismatch.role}
      </span>
      <span className="font-mono text-chatroom-text-muted">{describeModel(mismatch.current)}</span>
      <ArrowRight
        size={12}
        aria-hidden
        className="hidden shrink-0 text-chatroom-text-muted sm:block"
      />
      <span className="flex items-center gap-1 font-mono text-chatroom-text-primary">
        <Star
          size={12}
          fill="currentColor"
          aria-hidden
          className="shrink-0 text-chatroom-status-warning"
        />
        {describeModel(mismatch.favorite)}
      </span>
      {showWorkspaceLabel && (
        <span className="text-chatroom-text-muted">· {mismatch.workspaceLabel}</span>
      )}
    </li>
  );
}

function PromptBody({
  mismatches,
  showWorkspaceLabels,
}: {
  mismatches: readonly FavoriteMismatch[];
  showWorkspaceLabels: boolean;
}) {
  return (
    <>
      <p>{introCopy(mismatches.length)}</p>
      <ul className="max-h-[40dvh] space-y-1.5 overflow-y-auto border border-chatroom-border bg-chatroom-bg-tertiary p-3 text-xs">
        {mismatches.map((mismatch) => (
          <MismatchRow
            key={`${mismatch.workspaceId}|${mismatch.role}`}
            mismatch={mismatch}
            showWorkspaceLabel={showWorkspaceLabels}
          />
        ))}
      </ul>
      <p className="text-xs text-chatroom-text-muted">{EXPLANATION}</p>
    </>
  );
}

function ApplyErrorBody({
  mismatches,
  failures,
}: {
  mismatches: readonly FavoriteMismatch[];
  failures: readonly StartFavoriteFailure[];
}) {
  return (
    <>
      <div
        data-testid="start-favourites-error"
        className="space-y-1.5 border border-chatroom-status-error/40 bg-chatroom-status-error/10 p-3 text-xs text-chatroom-status-error"
      >
        <p className="font-bold">
          {`Could not apply ${failures.length} of ${mismatches.length} favourites`}
        </p>
        <ul className="space-y-1">
          {failures.map((failure) => (
            <li key={`${failure.workspaceLabel}|${failure.role}`}>
              {`${failure.role} (${failure.workspaceLabel}): ${failure.message}`}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-chatroom-text-muted">{savedSummary(mismatches, failures)}</p>
    </>
  );
}

interface PromptFooterProps {
  phase: StartFlowPhase;
  busy: boolean;
  primaryRef: RefObject<HTMLButtonElement | null>;
  onUseFavourites: () => void;
  onStartWithCurrent: () => void;
}

function PromptFooter({
  phase,
  busy,
  primaryRef,
  onUseFavourites,
  onStartWithCurrent,
}: PromptFooterProps) {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel
        className={FOOTER_BUTTON_CLASS}
        disabled={busy}
        data-testid="start-favourites-cancel"
      >
        Cancel
      </AlertDialogCancel>
      <Button
        type="button"
        variant="outline"
        className={SECONDARY_CLASS}
        disabled={busy}
        onClick={onStartWithCurrent}
        data-testid="start-favourites-current"
      >
        Start with current
      </Button>
      <Button
        ref={primaryRef}
        type="button"
        className={PRIMARY_CLASS}
        disabled={busy}
        onClick={onUseFavourites}
        data-testid="start-favourites-use"
      >
        <PrimaryLabel phase={phase} idle="Use favourites & start" />
      </Button>
    </AlertDialogFooter>
  );
}

interface ErrorFooterProps {
  phase: StartFlowPhase;
  busy: boolean;
  startAnywayRef: RefObject<HTMLButtonElement | null>;
  onStartAnyway: () => void;
}

function ErrorFooter({ phase, busy, startAnywayRef, onStartAnyway }: ErrorFooterProps) {
  return (
    <AlertDialogFooter>
      <AlertDialogCancel
        className={FOOTER_BUTTON_CLASS}
        disabled={busy}
        data-testid="start-favourites-cancel"
      >
        Cancel
      </AlertDialogCancel>
      <Button
        ref={startAnywayRef}
        type="button"
        className={PRIMARY_CLASS}
        disabled={busy}
        onClick={onStartAnyway}
        data-testid="start-favourites-start-anyway"
      >
        <PrimaryLabel phase={phase} idle="Start anyway" />
      </Button>
    </AlertDialogFooter>
  );
}

interface PromptVariantProps {
  phase: StartFlowPhase;
  busy: boolean;
  mismatches: readonly FavoriteMismatch[];
  showWorkspaceLabels: boolean;
  primaryRef: RefObject<HTMLButtonElement | null>;
  onUseFavourites: () => void;
  onStartWithCurrent: () => void;
}

/** Confirmation variant: mismatches, explanation and the three-way choice. */
function PromptVariant({
  phase,
  busy,
  mismatches,
  showWorkspaceLabels,
  primaryRef,
  onUseFavourites,
  onStartWithCurrent,
}: PromptVariantProps) {
  return (
    <>
      <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
        <PromptBody mismatches={mismatches} showWorkspaceLabels={showWorkspaceLabels} />
      </AlertDialogDescription>
      <PromptFooter
        phase={phase}
        busy={busy}
        primaryRef={primaryRef}
        onUseFavourites={onUseFavourites}
        onStartWithCurrent={onStartWithCurrent}
      />
    </>
  );
}

interface ErrorVariantProps {
  phase: StartFlowPhase;
  busy: boolean;
  mismatches: readonly FavoriteMismatch[];
  failures: readonly StartFavoriteFailure[];
  startAnywayRef: RefObject<HTMLButtonElement | null>;
  onStartAnyway: () => void;
}

/** Partial-failure variant: what failed, what was kept, and a single forward action. */
function ErrorVariant({
  phase,
  busy,
  mismatches,
  failures,
  startAnywayRef,
  onStartAnyway,
}: ErrorVariantProps) {
  return (
    <>
      <AlertDialogDescription render={<div className="space-y-3 text-left" />}>
        <ApplyErrorBody mismatches={mismatches} failures={failures} />
      </AlertDialogDescription>
      <ErrorFooter
        phase={phase}
        busy={busy}
        startAnywayRef={startAnywayRef}
        onStartAnyway={onStartAnyway}
      />
    </>
  );
}

export function StartWithFavoritesDialog({
  open,
  phase,
  mismatches,
  failures,
  showWorkspaceLabels,
  onUseFavourites,
  onStartWithCurrent,
  onStartAnyway,
  onCancel,
  finalFocusRef,
}: StartWithFavoritesDialogProps) {
  const busy = isBusyPhase(phase);
  const hasFailures = failures.length > 0;
  const primaryRef = useRef<HTMLButtonElement>(null);
  const startAnywayRef = useRef<HTMLButtonElement>(null);

  // When a failed apply replaces the buttons while open, move focus to the surviving action.
  useEffect(() => {
    if (open && hasFailures) startAnywayRef.current?.focus();
  }, [open, hasFailures]);

  return (
    // Portal events bubble through React to the sidebar row: contain them here. Escape must still reach onOpenChange.
    <div
      className="contents"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') event.stopPropagation();
      }}
    >
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) onCancel();
        }}
      >
        <AlertDialogContent
          data-testid="start-favourites-dialog"
          initialFocus={hasFailures ? startAnywayRef : primaryRef}
          finalFocus={finalFocusRef}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Start agents with your favourite models?</AlertDialogTitle>
            {hasFailures ? (
              <ErrorVariant
                phase={phase}
                busy={busy}
                mismatches={mismatches}
                failures={failures}
                startAnywayRef={startAnywayRef}
                onStartAnyway={onStartAnyway}
              />
            ) : (
              <PromptVariant
                phase={phase}
                busy={busy}
                mismatches={mismatches}
                showWorkspaceLabels={showWorkspaceLabels}
                primaryRef={primaryRef}
                onUseFavourites={onUseFavourites}
                onStartWithCurrent={onStartWithCurrent}
              />
            )}
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
