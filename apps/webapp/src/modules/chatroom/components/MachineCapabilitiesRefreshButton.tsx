'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { RefreshCw } from 'lucide-react';
import React, {
  memo,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';

const CAPABILITIES_REFRESH_COOLDOWN_MS = 10_000;

/**
 * Per-machine discovery refresh (models / harnesses). Inline status only — no toasts.
 */
export const MachineCapabilitiesRefreshButton = memo(function MachineCapabilitiesRefreshButton({
  chatroomId,
  machineId,
  daemonConnected,
  linkedToChatroom,
}: {
  chatroomId: string;
  machineId: string;
  daemonConnected: boolean;
  linkedToChatroom: boolean;
}) {
  const [activeBatchId, setActiveBatchId] = useState<Id<'chatroom_capabilities_refresh_batches'> | null>(
    null
  );
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [isRequesting, setIsRequesting] = useState(false);
  const [hint, setHint] = useState<{ tone: 'muted' | 'ok' | 'warn' | 'err'; text: string } | null>(
    null
  );
  const [, bumpCooldownTick] = useReducer((x: number) => x + 1, 0);
  const hintClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalHandledRef = useRef(false);

  const requestRefresh = useSessionMutation(api.machines.requestCapabilitiesRefresh);
  const batchSnapshot = useSessionQuery(
    api.machines.getCapabilitiesRefreshBatch,
    activeBatchId ? { batchId: activeBatchId } : 'skip'
  );

  const batchPending =
    Boolean(activeBatchId) &&
    batchSnapshot !== undefined &&
    batchSnapshot !== null &&
    batchSnapshot.batch.aggregateStatus === 'pending';

  const isInCooldown = Date.now() < cooldownUntil;
  const cooldownSecondsLeft = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => bumpCooldownTick(), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const clearHintSoon = useCallback((ms: number) => {
    if (hintClearTimerRef.current) clearTimeout(hintClearTimerRef.current);
    hintClearTimerRef.current = setTimeout(() => {
      setHint(null);
      hintClearTimerRef.current = null;
    }, ms);
  }, []);

  useEffect(() => {
    return () => {
      if (hintClearTimerRef.current) clearTimeout(hintClearTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setTimeout(() => setCooldownUntil(0), cooldownUntil - Date.now());
    return () => window.clearTimeout(id);
  }, [cooldownUntil]);

  useEffect(() => {
    terminalHandledRef.current = false;
  }, [activeBatchId]);

  useEffect(() => {
    if (!activeBatchId) return;
    if (batchSnapshot === undefined) return;
    if (batchSnapshot === null) {
      setHint({ tone: 'err', text: 'Could not load discovery status.' });
      setActiveBatchId(null);
      clearHintSoon(8000);
    }
  }, [activeBatchId, batchSnapshot, clearHintSoon]);

  useEffect(() => {
    if (!activeBatchId || batchSnapshot === undefined || batchSnapshot === null) return;
    if (batchSnapshot.batch.aggregateStatus === 'pending') return;
    if (terminalHandledRef.current) return;
    terminalHandledRef.current = true;

    const agg = batchSnapshot.batch.aggregateStatus;
    if (agg === 'completed') {
      setHint({ tone: 'ok', text: 'Discovery up to date.' });
    } else if (agg === 'failed') {
      const firstErr = batchSnapshot.machines.find((m) => m.errorMessage)?.errorMessage;
      setHint({ tone: 'err', text: firstErr ?? 'Discovery failed.' });
    } else {
      setHint({ tone: 'warn', text: 'Finished with errors.' });
    }
    setActiveBatchId(null);
    setCooldownUntil(Date.now() + CAPABILITIES_REFRESH_COOLDOWN_MS);
    clearHintSoon(agg === 'completed' ? 5000 : 10000);
  }, [activeBatchId, batchSnapshot, clearHintSoon]);

  useEffect(() => {
    if (!activeBatchId) return;
    if (batchSnapshot === undefined || batchSnapshot === null) return;
    if (batchSnapshot.batch.aggregateStatus !== 'pending') return;

    const timer = window.setTimeout(() => {
      setHint({ tone: 'warn', text: 'No response from daemon yet.' });
      setActiveBatchId(null);
      clearHintSoon(8000);
    }, 60_000);

    return () => clearTimeout(timer);
  }, [activeBatchId, batchSnapshot, clearHintSoon]);

  const canClick =
    linkedToChatroom &&
    daemonConnected &&
    !isInCooldown &&
    !isRequesting &&
    !batchPending;

  const disabledTitle = !linkedToChatroom
    ? 'This machine has no workspace in this chatroom.'
    : !daemonConnected
      ? 'Start the daemon on this machine to refresh discovery.'
      : isInCooldown
        ? `Wait ${cooldownSecondsLeft}s before refreshing again.`
        : isRequesting || batchPending
          ? 'Discovery in progress…'
          : 'Refresh model and harness discovery for this machine';

  const handleClick = useCallback(async () => {
    if (!canClick) return;
    setIsRequesting(true);
    setHint(null);
    if (hintClearTimerRef.current) {
      clearTimeout(hintClearTimerRef.current);
      hintClearTimerRef.current = null;
    }
    try {
      const result = await requestRefresh({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        machineId,
      });
      if (!result.applied) {
        if (result.reason === 'cooldown') {
          setCooldownUntil(Date.now() + result.retryAfterMs);
          setHint({
            tone: 'muted',
            text: `Wait ${Math.ceil(result.retryAfterMs / 1000)}s before refreshing again.`,
          });
          clearHintSoon(6000);
        } else if (result.reason === 'not_linked') {
          setHint({ tone: 'muted', text: 'This machine is not linked to this chatroom.' });
          clearHintSoon(6000);
        } else {
          setHint({ tone: 'err', text: 'Could not start discovery.' });
          clearHintSoon(6000);
        }
        return;
      }
      setActiveBatchId(result.batchId);
      setCooldownUntil(Date.now() + CAPABILITIES_REFRESH_COOLDOWN_MS);
    } catch {
      setHint({ tone: 'err', text: 'Request failed.' });
      clearHintSoon(6000);
    } finally {
      setIsRequesting(false);
    }
  }, [canClick, chatroomId, machineId, requestRefresh, clearHintSoon]);

  const hintClass =
    hint?.tone === 'ok'
      ? 'text-chatroom-status-success'
      : hint?.tone === 'err'
        ? 'text-chatroom-status-error'
        : hint?.tone === 'warn'
          ? 'text-chatroom-status-warning'
          : 'text-chatroom-text-muted';

  return (
    <div className="flex flex-col items-end gap-0.5 shrink-0 self-start pt-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={!canClick}
        className={[
          'touch-manipulation inline-flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-md border transition-colors',
          canClick
            ? 'border-chatroom-accent/50 bg-chatroom-bg-surface text-chatroom-accent shadow-sm hover:bg-chatroom-accent/10 hover:border-chatroom-accent'
            : 'border-chatroom-border/30 bg-chatroom-bg-tertiary/30 text-chatroom-text-muted/45 cursor-not-allowed',
        ].join(' ')}
        title={disabledTitle}
        aria-label="Refresh model and harness discovery for this machine"
        aria-disabled={!canClick}
      >
        <RefreshCw
          size={14}
          className={`shrink-0 ${isRequesting || batchPending ? 'animate-spin' : ''}`}
        />
      </button>
      {hint ? (
        <span className={`text-[8px] leading-tight max-w-[min(140px,36vw)] text-right ${hintClass}`}>
          {hint.text}
        </span>
      ) : null}
    </div>
  );
});
