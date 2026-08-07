'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { PlannerEnhancerToggleButton, type TeamSupportState } from './PlannerEnhancerToggleButton';
import { useActiveEnhancerJob } from '../hooks/useActiveEnhancerJob';
import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';
import type { EnhancerConfig } from '../types/enhancer';

interface PlannerEnhancerToggleProps {
  chatroomId: string;
  machineId: string | null | undefined;
  teamSupportState?: TeamSupportState;
}

/** True when config has the fields needed to enable without opening the dialog. */
function hasEnhancerConfigFields(config: EnhancerConfig | null): config is EnhancerConfig {
  return Boolean(config?.agentHarness && config.model && config.machineId);
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
      'Enhancer is only available on teams with a planner role. It supplements the planner workflow before delegating to the builder — use a Duo-style team to enable it.'
    );
  }, []);

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
