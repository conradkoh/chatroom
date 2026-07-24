'use client';

import { useCallback } from 'react';

import { EnhancerConfigQuickPick } from './EnhancerConfigQuickPick';
import { PlannerEnhancerToggleButton } from './PlannerEnhancerToggleButton';
import { useActiveEnhancerJob } from '../hooks/useActiveEnhancerJob';
import { useEnhancerConfigDialogHost } from '../hooks/useEnhancerConfigDialogHost';
import type { EnhancerConfig } from '../types/enhancer';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

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
  const {
    config,
    isActive,
    saveConfig,
    disable,
    favorites,
    removeFavorite,
    moveFavorite,
    openDialog,
    dialog,
  } = useEnhancerConfigDialogHost({ chatroomId, workspaceMachineId: machineId });
  const { isEnhancing, disableEnhancer, isDisabling } = useActiveEnhancerJob(chatroomId);

  const handleApplyFavorite = useCallback(
    (entry: EnhancerConfigEntry) => {
      const resolvedMachineId = config?.machineId ?? machineId;
      if (!resolvedMachineId) return;
      void saveConfig({
        enabled: isActive,
        targetId: entry.targetId,
        agentHarness: entry.agentHarness,
        model: entry.model,
        machineId: resolvedMachineId,
      });
    },
    [config?.machineId, machineId, isActive, saveConfig]
  );

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

      {config?.machineId && (
        <EnhancerConfigQuickPick
          favorites={favorites}
          disabled={isDisabling}
          onApply={handleApplyFavorite}
          onRemoveFavorite={(entry) => void removeFavorite(entry)}
          onMoveFavorite={(from, to) => void moveFavorite(from, to)}
        />
      )}

      {dialog}
    </>
  );
}
