'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { EnhancerConfigForm } from './EnhancerConfigForm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import {
  getMobileDrawerContentStyle,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from '../../../components/picker';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';
import type { AgentHarness } from '../../../types/machine';
import { ENHANCER_TARGETS } from '../constants/enhancerTargets';
import type { EnhancerConfig } from '../types/enhancer';
import {
  enhancerConfigEntriesEqual,
  filterFavoritesForTarget,
  isEnhancerConfigFavoriteForTarget,
} from '../types/enhancerConfigEntry';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

interface EnhancerConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatroomId: string;
  machineId: string | null | undefined;
  initialConfig: EnhancerConfig | null;

  onConfirm: (config: EnhancerConfig) => void;
  favorites: EnhancerConfigEntry[];
  isFavorite: (entry: EnhancerConfigEntry) => boolean;
  onAddFavorite: (entry: EnhancerConfigEntry) => void;
  onRemoveFavorite: (entry: EnhancerConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
}

// fallow-ignore-next-line complexity
export function EnhancerConfigDialog({
  open,
  onOpenChange,
  machineId,
  initialConfig,
  onConfirm,
  favorites,
  onAddFavorite,
  onRemoveFavorite,
  onMoveFavorite,
}: EnhancerConfigDialogProps) {
  const isDesktop = useIsDesktop();
  const keyboardInsetPx = useVisualViewportKeyboardInset(open && !isDesktop);

  const [targetId, setTargetId] = useState<string>(
    initialConfig?.targetId ?? ENHANCER_TARGETS[0].id
  );
  const [agentHarness, setAgentHarness] = useState<AgentHarness | null>(
    initialConfig?.agentHarness ?? null
  );
  const [model, setModel] = useState<string>(initialConfig?.model ?? '');

  useEffect(() => {
    if (!open) return;
    setTargetId(initialConfig?.targetId ?? ENHANCER_TARGETS[0].id);
    setAgentHarness(initialConfig?.agentHarness ?? null);
    setModel(initialConfig?.model ?? '');
  }, [open, initialConfig]);

  const canSave = !!targetId && !!agentHarness && !!model && !!machineId;

  const currentEntry = useMemo<EnhancerConfigEntry | null>(() => {
    if (!targetId || !agentHarness || !model) return null;
    return {
      targetId: targetId as EnhancerConfigEntry['targetId'],
      agentHarness,
      model,
    };
  }, [targetId, agentHarness, model]);

  const targetFavorites = useMemo(
    () => filterFavoritesForTarget(favorites, targetId as EnhancerConfigEntry['targetId']),
    [favorites, targetId]
  );

  const currentIsFavorite =
    currentEntry != null &&
    isEnhancerConfigFavoriteForTarget(
      favorites,
      currentEntry,
      targetId as EnhancerConfigEntry['targetId']
    );

  const handleApplyFavorite = useCallback((entry: EnhancerConfigEntry) => {
    setAgentHarness(entry.agentHarness);
    setModel(entry.model);
  }, []);

  const handleMoveFavorite = useCallback(
    (fromIndex: number, toIndex: number) => {
      const fromEntry = targetFavorites[fromIndex];
      const toEntry = targetFavorites[toIndex];
      if (!fromEntry || !toEntry) return;
      const globalFrom = favorites.findIndex((f) => enhancerConfigEntriesEqual(f, fromEntry));
      const globalTo = favorites.findIndex((f) => enhancerConfigEntriesEqual(f, toEntry));
      if (globalFrom >= 0 && globalTo >= 0) onMoveFavorite(globalFrom, globalTo);
    },
    [favorites, targetFavorites, onMoveFavorite]
  );

  const isCurrentlyEnabled = initialConfig?.enabled ?? false;
  const saveButtonLabel = isCurrentlyEnabled ? 'Save' : 'Save and enable';

  const handleSave = useCallback(() => {
    if (!canSave || !machineId) return;
    onConfirm({
      enabled: true,
      targetId: targetId as EnhancerConfig['targetId'],
      agentHarness,
      model,
      machineId,
    });
  }, [canSave, targetId, agentHarness, model, machineId, onConfirm]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setTargetId(initialConfig?.targetId ?? ENHANCER_TARGETS[0].id);
        setAgentHarness(initialConfig?.agentHarness ?? null);
        setModel(initialConfig?.model ?? '');
      }
      onOpenChange(nextOpen);
    },
    [initialConfig, onOpenChange]
  );

  const form = (
    <EnhancerConfigForm
      targetId={targetId}
      onTargetIdChange={setTargetId}
      machineId={machineId}
      agentHarness={agentHarness}
      model={model}
      onHarnessChange={setAgentHarness}
      onModelChange={setModel}
      canSave={canSave}
      saveButtonLabel={saveButtonLabel}
      onSave={handleSave}
      onCancel={() => onOpenChange(false)}
      currentEntry={currentEntry}
      currentIsFavorite={currentIsFavorite}
      targetFavorites={targetFavorites}
      onAddFavorite={onAddFavorite}
      onRemoveFavorite={onRemoveFavorite}
      onMoveFavorite={onMoveFavorite}
      handleApplyFavorite={handleApplyFavorite}
      handleMoveFavorite={handleMoveFavorite}
    />
  );

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} repositionInputs={false} handleOnly>
        <DrawerContent
          className={MOBILE_DRAWER_CONTENT_CLASSNAME}
          style={getMobileDrawerContentStyle(keyboardInsetPx)}
        >
          <DrawerHeader className="p-0 shrink-0">
            <DrawerTitle className="sr-only">Enhancer configuration</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <h2 className="text-base font-semibold text-chatroom-text-primary mb-1">
              Enhancer configuration
            </h2>
            <p className="text-xs text-chatroom-text-muted mb-3">
              Choose a planning review target and which enhancer model to use.
            </p>
            {form}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent floating className="sm:max-w-md max-h-[min(90dvh,100%)]">
        <DialogHeader>
          <DialogTitle>Enhancer configuration</DialogTitle>
          <DialogDescription>
            Choose a planning review target and which enhancer model to use.
          </DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
