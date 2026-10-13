'use client';

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import type { GitCloneViewState } from './lib/deriveGitCloneViewState';

interface PanelContext {
  machineName: string;
  onRetry: () => void;
}

type PanelRenderer = (state: GitCloneViewState, context: PanelContext) => ReactNode;

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="px-4 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover"
    >
      Try again
    </button>
  );
}

function WaitingPanel({ machineName, offline }: { machineName: string; offline: boolean }) {
  return (
    <div role="status" className="flex flex-col gap-2 text-xs text-chatroom-text-muted">
      <p className="flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" />
        Waiting for {machineName}…
      </p>
      {offline && <p>Machine appears offline.</p>}
    </div>
  );
}

function CloningPanel({ phase, percent }: { phase: string; percent: number | null }) {
  return (
    <div role="status" className="flex flex-col gap-2 text-xs text-chatroom-text-secondary">
      <p>{phase || 'Cloning…'}</p>
      {percent !== null && (
        <>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 bg-chatroom-bg-tertiary"
          >
            <div className="h-2 bg-chatroom-accent" style={{ width: `${percent}%` }} />
          </div>
          <p>{percent}%</p>
        </>
      )}
    </div>
  );
}

function RetryPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-chatroom-status-error">{message}</p>
      <RetryButton onRetry={onRetry} />
    </div>
  );
}

function FailedPanel({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail: string | undefined;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-chatroom-status-error">{message}</p>
      {detail && (
        <details className="text-xs text-chatroom-text-muted">
          <summary className="cursor-pointer">Details</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono">{detail}</pre>
        </details>
      )}
      <RetryButton onRetry={onRetry} />
    </div>
  );
}

/** One renderer per view state. Keyed by kind so adding a state is a single entry. */
const PANEL_RENDERERS: Record<GitCloneViewState['kind'], PanelRenderer> = {
  idle: () => null,
  waiting: (state, context) =>
    state.kind === 'waiting' ? (
      <WaitingPanel machineName={context.machineName} offline={state.offline} />
    ) : null,
  cloning: (state) =>
    state.kind === 'cloning' ? <CloningPanel phase={state.phase} percent={state.percent} /> : null,
  stalled: (_state, context) => (
    <RetryPanel
      message={`No progress from ${context.machineName} for 2 minutes.`}
      onRetry={context.onRetry}
    />
  ),
  timed_out: (_state, context) => (
    <RetryPanel
      message="The machine did not pick up the clone request."
      onRetry={context.onRetry}
    />
  ),
  completed: (state) =>
    state.kind === 'completed' ? (
      <p className="text-xs text-chatroom-status-success">Cloned to {state.clonedPath}</p>
    ) : null,
  failed: (state, context) =>
    state.kind === 'failed' ? (
      <FailedPanel message={state.message} detail={state.detail} onRetry={context.onRetry} />
    ) : null,
};

/** Status for the current clone: waiting, progress, a retryable problem, or the cloned path. */
export function CloneStatusPanel({
  state,
  machineName,
  onRetry,
}: {
  state: GitCloneViewState;
  machineName: string;
  onRetry: () => void;
}) {
  return <>{PANEL_RENDERERS[state.kind](state, { machineName, onRetry })}</>;
}
