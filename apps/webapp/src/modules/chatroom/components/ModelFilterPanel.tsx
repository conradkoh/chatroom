'use client';

import React, { useMemo } from 'react';

import { getModelDisplayLabel } from '../types/machine';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

  // Group models by provider
  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const model of availableModels) {
      const provider = model.split('/')[0];
      const existing = groups.get(provider) ?? [];
      existing.push(model);
      groups.set(provider, existing);
    }
    return groups;
  }, [availableModels]);

  const handleModelToggle = (modelId: string) => {
    if (disabled) return;
    // Toggle membership in hiddenModels — the isModelHidden() logic handles the semantics
    const isCurrentlyInList = hiddenModels.includes(modelId);
    const newHiddenModels = isCurrentlyInList
      ? hiddenModels.filter((m) => m !== modelId)
      : [...hiddenModels, modelId];
    onFilterChange(newHiddenModels, hiddenProviders);
  };

  const handleProviderToggle = (provider: string) => {
    if (disabled) return;
    const isProviderHidden = hiddenProviders.includes(provider);
    const providerModels = modelsByProvider.get(provider) ?? [];
    if (isProviderHidden) {
      // SHOW ALL — remove provider from hiddenProviders, also clear any overrides
      onFilterChange(
        hiddenModels.filter((m) => !providerModels.includes(m)),
        hiddenProviders.filter((p) => p !== provider)
      );
    } else {
      // HIDE ALL — add provider to hiddenProviders, clear individual model overrides
      const newHiddenModels = hiddenModels.filter((m) => !providerModels.includes(m));
      onFilterChange(newHiddenModels, [...hiddenProviders, provider]);
    }
  };

  const handleResetAll = () => {
    if (disabled) return;
    onFilterChange([], []);
  };

  // Count models that are effectively hidden (used for the header badge)
  const hiddenCount = useMemo(() => {
    return availableModels.filter((model) => {
      const provider = model.split('/')[0];
      const providerHidden = hiddenProviders.includes(provider);
      const hasOverride = hiddenModels.includes(model);
      return providerHidden ? !hasOverride : hasOverride;
    }).length;
  }, [availableModels, hiddenModels, hiddenProviders]);

  const hasAnyFilter = hiddenCount > 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="bg-chatroom-bg-primary border border-chatroom-border p-0 w-[300px] rounded-none"
        align="end"
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-chatroom-border bg-chatroom-bg-tertiary flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
            Model Visibility
          </span>
          {hiddenCount > 0 && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-chatroom-status-warning">
              {hiddenCount} HIDDEN
            </span>
          )}
        </div>

        {/* Model list grouped by provider */}
        <div className="max-h-96 overflow-y-auto">
          {Array.from(modelsByProvider.entries()).map(([provider, models]) => {
            const isProviderHidden = hiddenProviders.includes(provider);
            return (
              <div key={provider}>
                {/* Provider row */}
                <div className="px-3 py-1.5 border-b border-chatroom-border flex items-center justify-between bg-chatroom-bg-tertiary">
                  <span
                    className={
                      isProviderHidden
                        ? 'text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted opacity-60'
                        : 'text-[10px] font-bold uppercase tracking-wider text-chatroom-text-secondary'
                    }
                  >
                    {titleCaseProvider(provider)}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => handleProviderToggle(provider)}
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
                  const hasOverride = hiddenModels.includes(model);
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
        </div>

        {/* Reset button */}
        <button
          type="button"
          disabled={disabled || !hasAnyFilter}
          onClick={handleResetAll}
          className="w-full text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-error px-3 py-2 border-t border-chatroom-border text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset All
        </button>
      </PopoverContent>
    </Popover>
  );
}
