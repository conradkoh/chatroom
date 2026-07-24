'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { ModelFilterPanel } from '../ModelFilterPanel';
import { providerOptionsToFilterModelIds } from './modelGroups';
import type { UseMachineModelFilterResult } from './useMachineModelFilter';
import type { ProviderOption } from '../../direct-harness/components/harness-selectors/types';

export interface ModelFilterButtonProps {
  filter: UseMachineModelFilterResult;
  providers?: ProviderOption[];
  availableModels?: string[];
  disabled?: boolean;
  variant?: 'chatroom' | 'harness';
}

export function ModelFilterButton({
  filter,
  providers,
  availableModels,
  disabled,
  variant = 'harness',
}: ModelFilterButtonProps) {
  const [open, setOpen] = useState(false);

  const resolvedAvailableModels =
    availableModels ?? (providers ? providerOptionsToFilterModelIds(providers) : []);

  return (
    <ModelFilterPanel
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className={
            variant === 'harness'
              ? 'shrink-0 h-8 w-8 flex items-center justify-center border border-input bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors'
              : 'shrink-0 h-7 w-7 flex items-center justify-center bg-chatroom-bg-tertiary border border-chatroom-border text-chatroom-text-muted hover:text-chatroom-text-primary hover:border-chatroom-border-strong transition-colors'
          }
          title="Configure visible models"
          aria-label="Configure visible models"
          disabled={disabled}
        >
          <SlidersHorizontal size={12} />
        </button>
      }
      availableModels={resolvedAvailableModels}
      filter={filter.filter ?? null}
      onFilterChange={(hiddenModels, hiddenProviders) =>
        void filter.setFilter(hiddenModels, hiddenProviders)
      }
    />
  );
}
