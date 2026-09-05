// fallow-ignore-file complexity
'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  PlannerConversationModeToggleButton,
  type TeamSupportState,
} from './PlannerConversationModeToggleButton';
import { useComposerPreflightShortcut } from '../../../hooks/useComposerPreflightShortcut';
import { useConversationMode } from '../../../hooks/useConversationMode';
import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';
import { hasEnhancerConfigFields } from '../types/enhancer';

type ConversationMode = 'chat' | 'code' | 'code:enhanced';

interface PlannerConversationModeToggleProps {
  chatroomId: string;
  machineId: string | null | undefined;
  teamSupportState?: TeamSupportState;
}

function computeNextMode(mode: ConversationMode): ConversationMode {
  if (mode === 'chat') return 'code';
  if (mode === 'code') return 'code:enhanced';
  return 'chat';
}

function UnsupportedToggle({
  mode,
  onUnsupportedClick,
}: {
  mode: ConversationMode;
  onUnsupportedClick: () => void;
}) {
  return (
    <PlannerConversationModeToggleButton
      mode={mode}
      isBusy={false}
      teamSupportState="unsupported"
      onCycle={() => {}}
      onConfigure={() => {}}
      onUnsupportedClick={onUnsupportedClick}
    />
  );
}

function SupportedToggle({
  mode,
  isBusy,
  onCycle,
  onConfigure,
  onUnsupportedClick,
  dialog,
}: {
  mode: ConversationMode;
  isBusy: boolean;
  onCycle: () => void;
  onConfigure: () => void;
  onUnsupportedClick: () => void;
  dialog: React.ReactNode;
}) {
  return (
    <>
      <PlannerConversationModeToggleButton
        mode={mode}
        isBusy={isBusy}
        teamSupportState="supported"
        onCycle={onCycle}
        onConfigure={onConfigure}
        onUnsupportedClick={onUnsupportedClick}
      />

      {dialog}
    </>
  );
}

export function PlannerConversationModeToggle({
  chatroomId,
  machineId,
  teamSupportState = 'supported',
}: PlannerConversationModeToggleProps) {
  const { mode, setMode } = useConversationMode();
  const { config, saveConfig, disable, openDialog, dialog } = useEnhancerConfigDialogHost({
    chatroomId,
    workspaceMachineId: machineId,
  });
  const [isBusy, setIsBusy] = useState(false);

  // ── Optimistic reconciliation refs ──────────────────────────────────────
  // Generation counter: incremented on each activation; stale async results
  // are discarded when their generation no longer matches.
  const generationRef = useRef(0);
  // The last mode that was confirmed by the backend (for rollback on failure).
  const committedModeRef = useRef<ConversationMode>(mode);
  // Serialized mutation promise chain — ensures backend writes are ordered.
  const mutationChainRef = useRef<Promise<void>>(Promise.resolve());
  // Mounted guard: prevent state updates after unmount.
  const mountedRef = useRef(true);

  // Keep committedModeRef in sync with mode when it changes externally
  // (e.g. provider hydration from server state).
  const lastModeRef = useRef(mode);
  if (lastModeRef.current !== mode) {
    lastModeRef.current = mode;
    // Only sync committed mode if we're not in an active reconciliation.
    // During reconciliation, the toggle owns the mode lifecycle.
    if (generationRef.current === 0) {
      committedModeRef.current = mode;
    }
  }

  const handleCycle = useCallback(() => {
    const nextMode = computeNextMode(mode);

    // Incomplete config: open dialog, do not change mode.
    if (nextMode === 'code:enhanced' && !hasEnhancerConfigFields(config)) {
      openDialog();
      return;
    }

    // ── Immediate optimistic UI ─────────────────────────────────────────
    setMode(nextMode);

    // Non-boundary transitions (chat ↔ code) need no backend mutation.
    const crossesEnhancedBoundary = nextMode === 'code:enhanced' || mode === 'code:enhanced';
    if (!crossesEnhancedBoundary) {
      committedModeRef.current = nextMode;
      return;
    }

    // ── Serialized backend reconciliation ───────────────────────────────
    const gen = ++generationRef.current;
    const desiredEnabled = nextMode === 'code:enhanced';
    setIsBusy(true);

    // Chain onto existing promise so mutations are serialized.
    mutationChainRef.current = mutationChainRef.current.then(async () => {
      // Skip if a newer activation superseded this one.
      if (gen !== generationRef.current) return;

      try {
        if (desiredEnabled) {
          await saveConfig({ ...config!, enabled: true });
        } else {
          await disable();
        }

        // Success: settle on the requested mode (unless superseded).
        if (gen !== generationRef.current) return;
        committedModeRef.current = nextMode;
        setIsBusy(false);
      } catch {
        // Terminal failure: rollback only if no newer intent exists.
        if (gen !== generationRef.current) return;

        if (mountedRef.current) {
          setMode(committedModeRef.current);
          setIsBusy(false);
        }

        toast.error(
          desiredEnabled
            ? 'Failed to enable enhancement. Reverted to previous mode.'
            : 'Failed to disable enhancement. Keeping Enhanced mode.'
        );
      }
    });
  }, [mode, config, saveConfig, disable, openDialog, setMode]);

  const handleUnsupportedClick = useCallback(() => {
    toast.message(
      'Enhancer is available to Solo and Duo teams. Choose one of those team types to enable request-first planning input.'
    );
  }, []);

  const handleShortcut = useCallback(() => {
    if (teamSupportState === 'loading') return;
    if (teamSupportState !== 'supported') {
      handleUnsupportedClick();
      return;
    }
    handleCycle();
  }, [teamSupportState, handleUnsupportedClick, handleCycle]);

  useComposerPreflightShortcut({ code: 'KeyM', onTrigger: handleShortcut });

  if (teamSupportState !== 'supported') {
    return <UnsupportedToggle mode={mode} onUnsupportedClick={handleUnsupportedClick} />;
  }

  return (
    <SupportedToggle
      mode={mode}
      isBusy={isBusy}
      onCycle={handleCycle}
      onConfigure={openDialog}
      onUnsupportedClick={handleUnsupportedClick}
      dialog={dialog}
    />
  );
}
