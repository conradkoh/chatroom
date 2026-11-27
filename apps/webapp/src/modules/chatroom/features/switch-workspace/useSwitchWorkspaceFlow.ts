'use client';

import { useCallback, useRef, useState } from 'react';

import { classifySwitchError, type SwitchError } from './lib/switchWorkspaceCopy';

import {
  useChatroomWorkspace,
  type SwitchWorkspaceResult,
} from '@/modules/chatroom/context/ChatroomWorkspaceContext';
import { getWorkspaceDisplayHostname } from '@/modules/chatroom/types/workspace';

export type SwitchStage = 'choose' | 'review' | 'submitting' | 'done';

export interface SwitchTarget {
  machineId: string;
  machineLabel: string;
  /** False for an offline machine: the switch still works, agents cannot start there yet. */
  connected: boolean;
  workingDir: string;
}

/** The workspace the chatroom had when Review started. Frozen. */
export interface SwitchFrom {
  registryId: string;
  machineId: string | null;
  machineLabel: string;
  workingDir: string;
}

export interface SwitchWorkspaceFlow {
  stage: SwitchStage;
  /** stage === 'submitting' */
  busy: boolean;
  target: SwitchTarget | null;
  from: SwitchFrom | null;
  acknowledged: boolean;
  error: SwitchError | null;
  result: SwitchWorkspaceResult | null;
  /** stage === 'review' and the live active workspace id differs from from.registryId. */
  stale: boolean;
  /** Choose → Review. No-op without an active workspace. Freezes `from` from the live workspace. Clears error and acknowledgement. */
  startReview(target: SwitchTarget): void;
  /** Review → Choose. Ignored unless stage is 'review'. Keeps target so the chooser prefills. */
  back(): void;
  setAcknowledged(value: boolean): void;
  /** Clears the error only. */
  clearError(): void;
  /** Review → submitting → done. Never throws. No-op unless stage is 'review', acknowledged, and the live id equals from.registryId. */
  submit(): Promise<void>;
  /** Conflict → Choose. Clears error, target and from, so the chooser shows the live workspace. */
  reviewCurrent(): void;
  /** Any → Choose with nothing selected. Used by the checklist after Continue. */
  reset(): void;
}

/**
 * The switch stage machine shared by the dialog and the setup checklist.
 *
 * It owns only local state and reads the live workspace from the context. `submit` is the sole
 * caller of the context's `switchWorkspace`, and it refuses to run when the live workspace changed
 * after Review froze `from` — otherwise the user would confirm one workspace's consequences and
 * move away from another.
 */
// fallow-ignore-next-line complexity
export function useSwitchWorkspaceFlow(): SwitchWorkspaceFlow {
  const { activeWorkspace, switchWorkspace } = useChatroomWorkspace();
  const liveId = activeWorkspace?._registryId ?? null;
  // Latest live id for submit(), which runs after awaits. Written during render (same pattern as FixedModal's onCloseRef).
  const liveIdRef = useRef(liveId);
  liveIdRef.current = liveId;

  const [stage, setStage] = useState<SwitchStage>('choose');
  const [target, setTarget] = useState<SwitchTarget | null>(null);
  const [from, setFrom] = useState<SwitchFrom | null>(null);
  const [acknowledged, setAcknowledgedState] = useState(false);
  const [error, setError] = useState<SwitchError | null>(null);
  const [result, setResult] = useState<SwitchWorkspaceResult | null>(null);

  const stale = stage === 'review' && from !== null && from.registryId !== liveId;

  const startReview = useCallback(
    (next: SwitchTarget) => {
      if (!activeWorkspace?._registryId) return;
      setFrom({
        registryId: activeWorkspace._registryId,
        machineId: activeWorkspace.machineId,
        machineLabel: getWorkspaceDisplayHostname(activeWorkspace),
        workingDir: activeWorkspace.workingDir,
      });
      setTarget(next);
      setAcknowledgedState(false);
      setError(null);
      setStage('review');
    },
    [activeWorkspace]
  );

  const back = useCallback(() => {
    setStage((current) => (current === 'review' ? 'choose' : current));
  }, []);

  const setAcknowledged = useCallback(
    (value: boolean) => {
      if (stage === 'submitting') return;
      setAcknowledgedState(value);
    },
    [stage]
  );

  const clearError = useCallback(() => setError(null), []);

  // fallow-ignore-next-line complexity
  const submit = useCallback(async () => {
    if (stage !== 'review' || !acknowledged || !target || !from) return;
    if (liveIdRef.current !== from.registryId) return; // stale: the conflict panel is already showing
    setError(null);
    setStage('submitting');
    try {
      const next = await switchWorkspace(target.machineId, target.workingDir);
      setResult(next);
      setStage('done');
    } catch (err) {
      const classified = classifySwitchError(err);
      setError(classified);
      setStage(classified.kind === 'invalid-path' ? 'choose' : 'review');
    }
  }, [acknowledged, from, stage, switchWorkspace, target]);

  const reviewCurrent = useCallback(() => {
    setError(null);
    setTarget(null);
    setFrom(null);
    setAcknowledgedState(false);
    setStage('choose');
  }, []);

  const reset = useCallback(() => {
    setStage('choose');
    setTarget(null);
    setFrom(null);
    setAcknowledgedState(false);
    setError(null);
    setResult(null);
  }, []);

  return {
    stage,
    busy: stage === 'submitting',
    target,
    from,
    acknowledged,
    error,
    result,
    stale,
    startReview,
    back,
    setAcknowledged,
    clearError,
    submit,
    reviewCurrent,
    reset,
  };
}
