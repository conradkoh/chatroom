'use client';

import { useCallback, useState, type SyntheticEvent } from 'react';

import { EnhancerConfigDialog } from './EnhancerConfigDialog';
import { PlannerEnhancerToggleButton } from './PlannerEnhancerToggleButton';
import { useActiveEnhancerJob } from '../hooks/useActiveEnhancerJob';
import { useEnhancerConfig } from '../hooks/useEnhancerConfig';
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const { config, isActive, saveConfig, disable } = useEnhancerConfig(chatroomId);
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
        openDialog: () => setDialogOpen(true),
      }),
    [isActive, isEnhancing, config, disableEnhancer, disable, saveConfig]
  );

  const stopRowActivation = useCallback((e: SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <>
      <PlannerEnhancerToggleButton
        isActive={isActive}
        isEnhancing={isEnhancing}
        isDisabling={isDisabling}
        onToggle={handleToggle}
        onConfigure={() => setDialogOpen(true)}
        stopRowActivation={stopRowActivation}
      />

      <EnhancerConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        chatroomId={chatroomId}
        machineId={machineId}
        initialConfig={config}
        onConfirm={(cfg) => {
          saveConfig(cfg);
          setDialogOpen(false);
        }}
        onDisable={() => {
          disable();
          setDialogOpen(false);
        }}
      />
    </>
  );
}
