'use client';

import { useCallback } from 'react';

import { PlannerEnhancerToggleButton } from './PlannerEnhancerToggleButton';
import { useActiveEnhancerJob } from '../hooks/useActiveEnhancerJob';
import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';
import type { EnhancerConfig } from '../types/enhancer';

interface PlannerEnhancerToggleProps {
  chatroomId: string;
  machineId: string | null | undefined;
}

/** True when config has the fields needed to enable without opening the dialog. */
function hasEnhancerConfigFields(config: EnhancerConfig | null): config is EnhancerConfig {
  return Boolean(config?.agentHarness && config.model && config.machineId);
}

async function toggleEnhancerState(args: {
  isActive: boolean;
  isEnhancing: boolean;
  config: EnhancerConfig | null;
  disableEnhancer: () => Promise<void>;
  disable: () => Promise<void>;
  saveConfig: (cfg: EnhancerConfig) => Promise<void>;
  openDialog: () => void;
}): Promise<void> {
  if (args.isActive) {
    await (args.isEnhancing ? args.disableEnhancer() : args.disable());
    return;
  }

  if (hasEnhancerConfigFields(args.config)) {
    await args.saveConfig({ ...args.config, enabled: true });
    return;
  }

  args.openDialog();
}

export function PlannerEnhancerToggle({ chatroomId, machineId }: PlannerEnhancerToggleProps) {
  const { config, isActive, saveConfig, disable, openDialog, dialog } = useEnhancerConfigDialogHost(
    { chatroomId, workspaceMachineId: machineId }
  );
  const { isEnhancing, disableEnhancer, isDisabling } = useActiveEnhancerJob(chatroomId);

  const handleToggle = useCallback(
    () =>
      toggleEnhancerState({
        isActive,
        isEnhancing,
        config,
        disableEnhancer,
        disable,
        saveConfig,
        openDialog,
      }),
    [isActive, isEnhancing, config, disableEnhancer, disable, saveConfig, openDialog]
  );

  return (
    <>
      <PlannerEnhancerToggleButton
        isActive={isActive}
        isEnhancing={isEnhancing}
        isDisabling={isDisabling}
        onToggle={handleToggle}
        onConfigure={openDialog}
      />

      {dialog}
    </>
  );
}
