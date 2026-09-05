// fallow-ignore-file complexity
'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import {
  PlannerConversationModeToggleButton,
  type TeamSupportState,
} from './PlannerConversationModeToggleButton';
import { useComposerPreflightShortcut } from '../../../hooks/useComposerPreflightShortcut';
import { useConversationMode } from '../../../hooks/useConversationMode';
import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';
import { hasEnhancerConfigFields } from '../types/enhancer';

interface PlannerConversationModeToggleProps {
  chatroomId: string;
  machineId: string | null | undefined;
  teamSupportState?: TeamSupportState;
}

function computeNextMode(
  mode: 'chat' | 'code' | 'code:enhanced'
): 'chat' | 'code' | 'code:enhanced' {
  if (mode === 'chat') return 'code';
  if (mode === 'code') return 'code:enhanced';
  return 'chat';
}

async function executeModeTransition(args: {
  currentMode: 'chat' | 'code' | 'code:enhanced';
  nextMode: 'chat' | 'code' | 'code:enhanced';
  config: ReturnType<typeof useEnhancerConfigDialogHost>['config'];
  saveConfig: ReturnType<typeof useEnhancerConfigDialogHost>['saveConfig'];
  disable: ReturnType<typeof useEnhancerConfigDialogHost>['disable'];
  openDialog: ReturnType<typeof useEnhancerConfigDialogHost>['openDialog'];
  setMode: (mode: 'chat' | 'code' | 'code:enhanced') => void;
}): Promise<boolean> {
  const { currentMode, nextMode, config, saveConfig, disable, openDialog, setMode } = args;

  if (nextMode === 'code:enhanced') {
    if (hasEnhancerConfigFields(config)) {
      await saveConfig({ ...config, enabled: true });
      setMode('code:enhanced');
      return true;
    }
    openDialog();
    return false;
  }

  if (currentMode === 'code:enhanced' && nextMode === 'chat') {
    try {
      await disable();
    } catch {
      toast.error('Failed to disable enhancement. Keeping Enhanced mode.');
      return false;
    }
    setMode('chat');
    return true;
  }

  setMode(nextMode);
  return true;
}

function UnsupportedToggle({
  mode,
  onUnsupportedClick,
}: {
  mode: 'chat' | 'code' | 'code:enhanced';
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
  mode: 'chat' | 'code' | 'code:enhanced';
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

  const handleCycle = useCallback(async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      const nextMode = computeNextMode(mode);
      await executeModeTransition({
        currentMode: mode,
        nextMode,
        config,
        saveConfig,
        disable,
        openDialog,
        setMode,
      });
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, mode, config, saveConfig, disable, openDialog, setMode]);

  const handleUnsupportedClick = useCallback(() => {
    toast.message(
      'Enhancer is available to Solo and Duo teams. Choose one of those team types to enable request-first planning input.'
    );
  }, []);

  const handleShortcut = useCallback(() => {
    if (teamSupportState === 'loading' || isBusy) return;
    if (teamSupportState !== 'supported') {
      handleUnsupportedClick();
      return;
    }
    void handleCycle();
  }, [teamSupportState, isBusy, handleUnsupportedClick, handleCycle]);

  useComposerPreflightShortcut({ code: 'KeyE', onTrigger: handleShortcut });

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
