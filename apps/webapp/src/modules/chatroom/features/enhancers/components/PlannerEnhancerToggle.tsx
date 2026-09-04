'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { PlannerEnhancerToggleButton, type TeamSupportState } from './PlannerEnhancerToggleButton';
import { useComposerPreflightShortcut } from '../../../hooks/useComposerPreflightShortcut';
import { useActiveEnhancerJob } from '../hooks/useActiveEnhancerJob';
import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';
import { hasEnhancerConfigFields, type EnhancerConfig } from '../types/enhancer';

interface PlannerEnhancerToggleProps {
  chatroomId: string;
  machineId: string | null | undefined;
  teamSupportState?: TeamSupportState;
}

async function toggleEnhancerState(args: {
  isActive: boolean;
  config: EnhancerConfig | null;
  disable: () => Promise<void>;
  saveConfig: (cfg: EnhancerConfig) => Promise<void>;
  openDialog: () => void;
}): Promise<void> {
  if (args.isActive) {
    // Disabling only affects the next message — never cancels the in-flight job.
    await args.disable();
    return;
  }

  if (hasEnhancerConfigFields(args.config)) {
    await args.saveConfig({ ...args.config, enabled: true });
    return;
  }

  args.openDialog();
}

export function PlannerEnhancerToggle({
  chatroomId,
  machineId,
  teamSupportState = 'supported',
}: PlannerEnhancerToggleProps) {
  const { config, isActive, saveConfig, disable, openDialog, dialog } = useEnhancerConfigDialogHost(
    { chatroomId, workspaceMachineId: machineId }
  );
  const { isEnhancing } = useActiveEnhancerJob(chatroomId);
  const [isDisabling, setIsDisabling] = useState(false);

  const handleToggle = useCallback(async () => {
    if (isDisabling) return;
    setIsDisabling(true);
    try {
      await toggleEnhancerState({ isActive, config, disable, saveConfig, openDialog });
    } finally {
      setIsDisabling(false);
    }
  }, [isActive, config, disable, saveConfig, openDialog, isDisabling]);

  const handleUnsupportedClick = useCallback(() => {
    toast.message(
      'Enhancer is available to Solo and Duo teams. Choose one of those team types to enable request-first planning input.'
    );
  }, []);

  const handleShortcut = useCallback(() => {
    if (teamSupportState === 'loading' || isDisabling) return;
    if (teamSupportState !== 'supported') {
      handleUnsupportedClick();
      return;
    }
    void handleToggle();
  }, [teamSupportState, isDisabling, handleUnsupportedClick, handleToggle]);

  useComposerPreflightShortcut({ code: 'KeyE', onTrigger: handleShortcut });

  if (teamSupportState !== 'supported') {
    return (
      <PlannerEnhancerToggleButton
        isActive={false}
        isEnhancing={false}
        isDisabling={false}
        teamSupportState={teamSupportState}
        onToggle={() => {}}
        onConfigure={() => {}}
        onUnsupportedClick={handleUnsupportedClick}
      />
    );
  }

  return (
    <>
      <PlannerEnhancerToggleButton
        isActive={isActive}
        isEnhancing={isEnhancing}
        isDisabling={isDisabling}
        teamSupportState="supported"
        onToggle={handleToggle}
        onConfigure={openDialog}
        onUnsupportedClick={handleUnsupportedClick}
      />

      {dialog}
    </>
  );
}
