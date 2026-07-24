'use client';

import { useCallback, useState } from 'react';

import { useEnhancerConfig } from './useEnhancerConfig';
import { useEnhancerConfigFavorites } from './useEnhancerConfigFavorites';
import { EnhancerConfigDialog } from '../components/EnhancerConfigDialog';
import type { EnhancerConfig } from '../types/enhancer';

interface UseEnhancerConfigDialogHostOptions {
  chatroomId: string;
  /** Workspace machine fallback when config has no machineId yet. */
  workspaceMachineId: string | null | undefined;
}

export function useEnhancerConfigDialogHost({
  chatroomId,
  workspaceMachineId,
}: UseEnhancerConfigDialogHostOptions) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { config, isActive, saveConfig, disable } = useEnhancerConfig(chatroomId);
  const favoritesMachineId = config?.machineId ?? null;
  const { favorites, addFavorite, removeFavorite, moveFavorite, isFavorite } =
    useEnhancerConfigFavorites(favoritesMachineId);

  const dialogMachineId = config?.machineId ?? workspaceMachineId;

  const openDialog = useCallback(() => setDialogOpen(true), []);

  const handleConfirm = useCallback(
    (cfg: EnhancerConfig) => {
      void saveConfig(cfg);
      setDialogOpen(false);
    },
    [saveConfig]
  );

  const handleDisable = useCallback(() => {
    void disable();
    setDialogOpen(false);
  }, [disable]);

  const dialog = (
    <EnhancerConfigDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      chatroomId={chatroomId}
      machineId={dialogMachineId}
      initialConfig={config}
      favorites={favorites}
      isFavorite={isFavorite}
      onAddFavorite={(entry) => void addFavorite(entry)}
      onRemoveFavorite={(entry) => void removeFavorite(entry)}
      onMoveFavorite={(from, to) => void moveFavorite(from, to)}
      onConfirm={handleConfirm}
      onDisable={handleDisable}
    />
  );

  return {
    config,
    isActive,
    saveConfig,
    disable,
    favorites,
    removeFavorite,
    moveFavorite,
    dialogOpen,
    setDialogOpen,
    openDialog,
    dialog,
  };
}
