'use client';

/**
 * Rescan control: asks the machine to rescan its agent folders, then watches the
 * roster signature for the result.
 *
 * Success is never assumed from `{ queued: true }` — only a changed signature
 * proves the rescan found something. A 10 s wait reports "No changes found."
 * rather than implying the rescan failed.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { Check, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { customAgentMutationErrorMessage } from './customAgentCopy';

import { Button } from '@/components/ui/button';

const CUSTOM_AGENTS_RESCAN_WAIT_MS = 10_000;
const HINT_CLEAR_MS = 6_000;
const UPDATED_TICK_MS = 1_000;

type Phase = 'idle' | 'requesting' | 'waiting' | 'updated' | 'unchanged' | 'error';

export interface CustomAgentsRescanButtonProps {
  chatroomId: string;
  canRescan: boolean;
  /** 'Daemon offline.' | 'Loading…' | null */
  disabledReason: string | null;
  changeSignature: string | null;
}

export function CustomAgentsRescanButton({
  chatroomId,
  canRescan,
  disabledReason,
  changeSignature,
}: CustomAgentsRescanButtonProps) {
  const requestRefresh = useSessionMutation(api.customAgents.requestRefresh);
  const [phase, setPhase] = useState<Phase>('idle');
  const [hint, setHint] = useState('');
  const baseline = useRef<string | null>(null);
  const timers = useRef<number[]>([]);

  const schedule = useCallback((action: () => void, ms: number) => {
    const handle = window.setTimeout(action, ms);
    timers.current.push(handle);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const handle of pending) window.clearTimeout(handle);
      pending.length = 0;
    };
  }, []);

  const handleClick = useCallback(() => {
    baseline.current = changeSignature;
    setPhase('requesting');
    void Promise.resolve(requestRefresh({ chatroomId: chatroomId as Id<'chatroom_rooms'> })).then(
      () => setPhase('waiting'),
      (error: unknown) => {
        setHint(customAgentMutationErrorMessage(error));
        setPhase('error');
        schedule(() => setPhase('idle'), HINT_CLEAR_MS);
      }
    );
  }, [changeSignature, chatroomId, requestRefresh, schedule]);

  // A changed signature is the only proof the rescan found something.
  // This is a server-truth subscription, not render state derived from a prop:
  // the signature arrives asynchronously, long after the click.
  /* eslint-disable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change, react-you-might-not-need-an-effect/no-chain-state-updates */
  useEffect(() => {
    if (phase !== 'waiting' || changeSignature === null) return;
    if (changeSignature === baseline.current) return;
    setPhase('updated');
    schedule(() => setPhase('idle'), UPDATED_TICK_MS);
  }, [phase, changeSignature, schedule]);
  /* eslint-enable react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change, react-you-might-not-need-an-effect/no-chain-state-updates */

  // Bounded wait: report "no changes" instead of spinning forever.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const handle = window.setTimeout(() => {
      setPhase('unchanged');
      schedule(() => setPhase('idle'), HINT_CLEAR_MS);
    }, CUSTOM_AGENTS_RESCAN_WAIT_MS);
    return () => window.clearTimeout(handle);
  }, [phase, schedule]);

  return (
    <RescanControl
      phase={phase}
      hint={hint}
      canRescan={canRescan}
      disabledReason={disabledReason}
      onClick={handleClick}
    />
  );
}

function RescanControl({
  phase,
  hint,
  canRescan,
  disabledReason,
  onClick,
}: {
  phase: Phase;
  hint: string;
  canRescan: boolean;
  disabledReason: string | null;
  onClick: () => void;
}): ReactNode {
  const busy = phase === 'requesting' || phase === 'waiting';
  const offline = !canRescan && disabledReason === 'Daemon offline.';

  return (
    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
      <Button
        data-testid="custom-agents-rescan"
        variant="outline"
        size="sm"
        className="min-w-[7.5rem] justify-center text-xs gap-1.5"
        disabled={isDisabled(phase, canRescan)}
        title={disabledReason ?? 'Scan the agent folders on this machine now'}
        onClick={onClick}
      >
        <RescanIcon phase={phase} busy={busy} />
        {phaseLabel(phase, busy)}
      </Button>
      <span
        aria-live="polite"
        className={`min-h-[12px] text-[10px] font-mono font-bold leading-tight tracking-wide ${toneFor(phase, offline)}`}
      >
        {hintText(phase, hint, offline)}
      </span>
    </div>
  );
}

/** `updated` also disables the button so the success tick is not interrupted. */
function isDisabled(phase: Phase, canRescan: boolean): boolean {
  if (!canRescan) return true;
  return phase === 'requesting' || phase === 'waiting' || phase === 'updated';
}

function RescanIcon({ phase, busy }: { phase: Phase; busy: boolean }): ReactNode {
  if (phase === 'updated') {
    return <Check size={14} className="text-chatroom-status-success" aria-hidden />;
  }
  return <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden />;
}

function phaseLabel(phase: Phase, busy: boolean): string {
  if (busy) return 'Rescanning…';
  return phase === 'updated' ? 'Updated' : 'Rescan';
}

function toneFor(phase: Phase, offline: boolean): string {
  if (phase === 'error') return 'text-chatroom-status-error';
  return offline ? 'text-chatroom-status-warning' : 'text-chatroom-text-muted';
}

const PHASE_HINTS: Partial<Record<Phase, string>> = {
  requesting: 'This can take a few seconds.',
  waiting: 'This can take a few seconds.',
  unchanged: 'No changes found.',
};

function hintText(phase: Phase, hint: string, offline: boolean): string {
  const known = PHASE_HINTS[phase];
  if (known !== undefined) return known;
  if (phase === 'error') return hint;
  return offline ? 'Daemon offline.' : '';
}
