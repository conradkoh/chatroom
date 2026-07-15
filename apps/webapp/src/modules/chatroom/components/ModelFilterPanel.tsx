'use client';

import React, { useMemo, useState, useCallback } from 'react';

import { PickerPanelHeader, PickerScrollBody, PickerSearch, ResponsivePickerShell } from './picker';
import { getModelDisplayLabel } from '../types/machine';
import { getModelProviderKey, UNPREFIXED_PROVIDER_KEY } from '../utils/modelSelection';

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
 * Title-case a provider name (e.g. "github-copilot" → "Github-Copilot")
 */
function titleCaseProvider(provider: string): string {
  return provider
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

function getProviderDisplayName(providerKey: string): string {
  if (providerKey === UNPREFIXED_PROVIDER_KEY) return 'Models';
  return titleCaseProvider(providerKey);
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

  // Clear search when popover closes
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setSearchTerm('');
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  // Group models by provider key (unprefixed bare slugs share one group)
  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const model of availableModels) {
      const providerKey = getModelProviderKey(model);
      const existing = groups.get(providerKey) ?? [];
      existing.push(model);
      groups.set(providerKey, existing);
    }
    return groups;
  }, [availableModels]);

  // Filter models by search term
  const filteredModelsByProvider = useMemo(() => {
    if (!searchTerm.trim()) return modelsByProvider;
    const term = searchTerm.toLowerCase();
    const filtered = new Map<string, string[]>();
    for (const [providerKey, models] of modelsByProvider.entries()) {
      const providerLabel = getProviderDisplayName(providerKey);
      // Match against provider name or model display label
      const matchingModels = models.filter(
        (model) =>
          providerLabel.toLowerCase().includes(term) ||
          providerKey.toLowerCase().includes(term) ||
          model.toLowerCase().includes(term) ||
          getModelDisplayLabel(model).toLowerCase().includes(term)
      );
      if (matchingModels.length > 0) {
        filtered.set(providerKey, matchingModels);
      }
    }
    return filtered;
  }, [modelsByProvider, searchTerm]);

  const allProviderKeys = useMemo(() => Array.from(modelsByProvider.keys()), [modelsByProvider]);

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
      // Toggle membership in hiddenModels — the isModelHidden() logic handles the semantics
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
      const providerModels = modelsByProvider.get(provider) ?? [];
      const providerModelSet = new Set(providerModels);
      if (isProviderHidden) {
        // SHOW ALL — remove provider from hiddenProviders, also clear any overrides
        onFilterChange(
          hiddenModels.filter((m) => !providerModelSet.has(m)),
          hiddenProviders.filter((p) => p !== provider)
        );
      } else {
        // HIDE ALL — add provider to hiddenProviders, clear individual model overrides
        const newHiddenModels = hiddenModels.filter((m) => !providerModelSet.has(m));
        onFilterChange(newHiddenModels, [...hiddenProviders, provider]);
      }
    },
    [disabled, hiddenModels, hiddenProviders, hiddenProvidersSet, modelsByProvider, onFilterChange]
  );

  // Count models that are effectively hidden (used for the header badge)
  const hiddenCount = useMemo(() => {
    return availableModels.filter((model) => {
      const providerKey = getModelProviderKey(model);
      const providerHidden = hiddenProvidersSet.has(providerKey);
      const hasOverride = hiddenModelsSet.has(model);
      return providerHidden ? !hasOverride : hasOverride;
    }).length;
  }, [availableModels, hiddenModelsSet, hiddenProvidersSet]);

  const hasAnyFilter = hiddenCount > 0;

  const panelContent = (
    <>
      {/* Header */}
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

      {/* Model list grouped by provider */}
      <PickerScrollBody maxHeightClassName="max-h-[576px]">
        {Array.from(filteredModelsByProvider.entries()).map(([providerKey, models]) => {
          const isProviderHidden = hiddenProvidersSet.has(providerKey);
          return (
            <div key={providerKey}>
              {/* Provider row */}
              <div className="px-3 py-1.5 border-b border-chatroom-border flex items-center justify-between bg-chatroom-bg-tertiary">
                <span
                  className={
                    isProviderHidden
                      ? 'text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted opacity-60'
                      : 'text-[10px] font-bold uppercase tracking-wider text-chatroom-text-secondary'
                  }
                >
                  {getProviderDisplayName(providerKey)}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleProviderToggle(providerKey)}
                  className={cn(
                    'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                    isProviderHidden
                      ? 'border-chatroom-status-warning text-chatroom-status-warning hover:border-chatroom-status-warning/80 hover:text-chatroom-status-warning/80'
                      : 'border-chatroom-border text-chatroom-text-muted hover:text-chatroom-text-primary hover:border-chatroom-border-strong'
                  )}
                >
                  {isProviderHidden ? 'Show All' : 'Hide All'}
                </button>
              </div>

              {/* Individual model rows — always shown, even when provider is hidden */}
              {models.map((model) => {
                const hasOverride = hiddenModelsSet.has(model);
                // Effective visibility: provider hidden means model is hidden unless there's an override
                const isEffectivelyHidden = isProviderHidden ? !hasOverride : hasOverride;

                return (
                  <div
                    key={model}
                    className={cn(
                      'py-1 flex items-center gap-2 hover:bg-chatroom-bg-hover cursor-pointer group',
                      isProviderHidden ? 'pl-5 pr-4 border-l-2 border-chatroom-border' : 'px-4'
                    )}
                    onClick={() => handleModelToggle(model)}
                    role="checkbox"
                    aria-checked={!isEffectivelyHidden}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleModelToggle(model);
                      }
                    }}
                  >
                    {/* Square indicator: filled = visible, empty = hidden */}
                    <div
                      className={
                        isEffectivelyHidden
                          ? 'w-3 h-3 border border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0'
                          : 'w-3 h-3 border border-chatroom-accent bg-chatroom-accent flex-shrink-0'
                      }
                    />
                    <span
                      className={
                        isEffectivelyHidden
                          ? 'text-[10px] uppercase tracking-wider text-chatroom-text-muted flex-1 truncate opacity-50'
                          : 'text-[10px] uppercase tracking-wider text-chatroom-text-primary flex-1 truncate'
                      }
                    >
                      {getModelDisplayLabel(model)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </PickerScrollBody>

      {/* Reset button */}
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
      contentClassName="w-[420px]"
      disabled={disabled}
    >
      {panelContent}
    </ResponsivePickerShell>
  );
}
