'use client';

import React, { useMemo, useState, useCallback } from 'react';

import { PickerPanelHeader, PickerScrollBody, PickerSearch, ResponsivePickerShell } from './picker';
import { getModelProviderKey } from '../utils/modelSelection';
import { MODEL_PICKER_PANEL_WIDTH, MODEL_PICKER_SCROLL_MAX_H } from './model-selection/constants';
import { ModelGroupedList } from './model-selection/ModelGroupedList';
import { groupFlatModels } from './model-selection/modelGroups';
import { isModelEffectivelyHidden } from './model-selection/modelVisibility';

import { cn } from '@/lib/utils';

interface ModelFilterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Trigger element — the filter icon button */
  trigger: React.ReactNode;
  /** All available model IDs for this machine+harness */
  availableModels: string[];
  /** Current filter state (null if no filter doc exists yet) */
  filter: { hiddenModels: string[]; hiddenProviders: string[] } | null | undefined;
  /** Called when user toggles a model or provider */
  onFilterChange: (hiddenModels: string[], hiddenProviders: string[]) => void;
  /** Disabled when agent is running */
  disabled?: boolean;
}

/**
 * ModelFilterPanel — Popover panel for configuring model visibility per machine+harness.
 * Groups models by provider, with toggles for individual models and entire providers.
 *
 * Semantics of hiddenModels:
 * - When provider is NOT in hiddenProviders: hiddenModels = models to explicitly hide
 * - When provider IS in hiddenProviders: hiddenModels = exception overrides (models to show)
 */
export function ModelFilterPanel({
  open,
  onOpenChange,
  trigger,
  availableModels,
  filter,
  onFilterChange,
  disabled,
}: ModelFilterPanelProps) {
  const hiddenModels = filter?.hiddenModels ?? [];
  const hiddenProviders = filter?.hiddenProviders ?? [];

  const hiddenModelsSet = useMemo(() => new Set(hiddenModels), [hiddenModels]);
  const hiddenProvidersSet = useMemo(() => new Set(hiddenProviders), [hiddenProviders]);

  const [searchTerm, setSearchTerm] = useState('');

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setSearchTerm('');
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const modelGroups = useMemo(() => groupFlatModels(availableModels), [availableModels]);
  const allProviderKeys = useMemo(
    () => modelGroups.map((group) => group.providerKey),
    [modelGroups]
  );

  const allHidden = useMemo(
    () => allProviderKeys.length > 0 && allProviderKeys.every((key) => hiddenProvidersSet.has(key)),
    [allProviderKeys, hiddenProvidersSet]
  );

  const clearAllFilters = useCallback(() => {
    if (disabled) return;
    onFilterChange([], []);
  }, [disabled, onFilterChange]);

  const handleHideAll = useCallback(() => {
    if (disabled) return;
    onFilterChange([], allProviderKeys);
  }, [disabled, onFilterChange, allProviderKeys]);

  const handleModelToggle = useCallback(
    (modelId: string) => {
      if (disabled) return;
      const isCurrentlyInList = hiddenModelsSet.has(modelId);
      const newHiddenModels = isCurrentlyInList
        ? hiddenModels.filter((m) => m !== modelId)
        : [...hiddenModels, modelId];
      onFilterChange(newHiddenModels, hiddenProviders);
    },
    [disabled, hiddenModels, hiddenModelsSet, hiddenProviders, onFilterChange]
  );

  const handleProviderToggle = useCallback(
    (provider: string) => {
      if (disabled) return;
      const isProviderHidden = hiddenProvidersSet.has(provider);
      const providerModels =
        modelGroups.find((group) => group.providerKey === provider)?.options.map((o) => o.value) ??
        [];
      const providerModelSet = new Set(providerModels);
      if (isProviderHidden) {
        onFilterChange(
          hiddenModels.filter((m) => !providerModelSet.has(m)),
          hiddenProviders.filter((p) => p !== provider)
        );
      } else {
        const newHiddenModels = hiddenModels.filter((m) => !providerModelSet.has(m));
        onFilterChange(newHiddenModels, [...hiddenProviders, provider]);
      }
    },
    [disabled, hiddenModels, hiddenProviders, hiddenProvidersSet, modelGroups, onFilterChange]
  );

  const hiddenCount = useMemo(() => {
    return availableModels.filter((model) =>
      isModelEffectivelyHidden(
        model,
        getModelProviderKey(model),
        hiddenModelsSet,
        hiddenProvidersSet
      )
    ).length;
  }, [availableModels, hiddenModelsSet, hiddenProvidersSet]);

  const hasAnyFilter = hiddenCount > 0;

  const panelContent = (
    <>
      <PickerPanelHeader title="Model Visibility" className="shrink-0">
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-chatroom-status-warning">
              {hiddenCount} HIDDEN
            </span>
          )}
          {allProviderKeys.length > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={allHidden ? clearAllFilters : handleHideAll}
              className={cn(
                'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                allHidden
                  ? 'border-chatroom-status-warning text-chatroom-status-warning hover:border-chatroom-status-warning/80 hover:text-chatroom-status-warning/80'
                  : 'border-chatroom-border text-chatroom-text-muted hover:text-chatroom-text-primary hover:border-chatroom-border-strong'
              )}
            >
              {allHidden ? 'Show All' : 'Hide All'}
            </button>
          )}
        </div>
      </PickerPanelHeader>

      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search models..." />

      <PickerScrollBody maxHeightClassName={MODEL_PICKER_SCROLL_MAX_H}>
        <ModelGroupedList
          mode="visibility-toggle"
          groups={modelGroups}
          hiddenModels={hiddenModels}
          hiddenProviders={hiddenProviders}
          onModelToggle={handleModelToggle}
          onProviderToggle={handleProviderToggle}
          searchTerm={searchTerm}
          disabled={disabled}
        />
      </PickerScrollBody>

      <button
        type="button"
        disabled={disabled || !hasAnyFilter}
        onClick={clearAllFilters}
        className="w-full shrink-0 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-error px-3 py-2 border-t border-chatroom-border text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Reset All
      </button>
    </>
  );

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      trigger={trigger}
      title="Model Visibility"
      align="end"
      contentClassName={MODEL_PICKER_PANEL_WIDTH}
      disabled={disabled}
    >
      {panelContent}
    </ResponsivePickerShell>
  );
}
