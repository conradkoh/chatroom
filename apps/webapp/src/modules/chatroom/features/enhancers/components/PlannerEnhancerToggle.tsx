'use client';

import { useCallback, useState } from 'react';

import { EnhancerConfigDialog } from './EnhancerConfigDialog';
import { EnhancerConfigQuickPick } from './EnhancerConfigQuickPick';
import { PlannerEnhancerToggleButton } from './PlannerEnhancerToggleButton';
import { useActiveEnhancerJob } from '../hooks/useActiveEnhancerJob';
import { useEnhancerConfig } from '../hooks/useEnhancerConfig';
import { useEnhancerConfigFavorites } from '../hooks/useEnhancerConfigFavorites';
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const { config, isActive, saveConfig, disable } = useEnhancerConfig(chatroomId);
  const { isEnhancing, disableEnhancer, isDisabling } = useActiveEnhancerJob(chatroomId);
  const { favorites, addFavorite, removeFavorite, moveFavorite, isFavorite } =
    useEnhancerConfigFavorites(machineId);

  const handleApplyFavorite = useCallback(
    (entry: EnhancerConfigEntry) => {
      if (!machineId) return;
      void saveConfig({
        enabled: isActive,
        targetId: entry.targetId,
        agentHarness: entry.agentHarness,
        model: entry.model,
        machineId,
      });
    },
    [machineId, isActive, saveConfig]
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
        openDialog: () => setDialogOpen(true),
      }),
    [isActive, isEnhancing, config, disableEnhancer, disable, saveConfig]
  );

  return (
    <>
      <PlannerEnhancerToggleButton
        isActive={isActive}
        isEnhancing={isEnhancing}
        isDisabling={isDisabling}
        onToggle={handleToggle}
        onConfigure={() => setDialogOpen(true)}
      />

      {machineId && (
        <EnhancerConfigQuickPick
          favorites={favorites}
          disabled={isDisabling}
          onApply={handleApplyFavorite}
          onRemoveFavorite={(entry) => void removeFavorite(entry)}
          onMoveFavorite={(from, to) => void moveFavorite(from, to)}
        />
      )}

      <EnhancerConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        chatroomId={chatroomId}
        machineId={machineId}
        initialConfig={config}
        favorites={favorites}
        isFavorite={isFavorite}
        onAddFavorite={(entry) => void addFavorite(entry)}
        onRemoveFavorite={(entry) => void removeFavorite(entry)}
        onMoveFavorite={(from, to) => void moveFavorite(from, to)}
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
