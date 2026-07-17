'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { ModelFilterPanel } from '../../../components/ModelFilterPanel';
import type { UseHarnessModelFilterResult } from '../../hooks/useHarnessModelFilter';
import type { ProviderOption } from './types';

interface HarnessFilterButtonProps {
  filter: UseHarnessModelFilterResult;
  /** Full provider list — used to build the availableModels array for ModelFilterPanel. */
  providers: ProviderOption[];
}

export function HarnessFilterButton({ filter, providers }: HarnessFilterButtonProps) {
  const [open, setOpen] = useState(false);

  // Build availableModels in "providerID/modelID" format for ModelFilterPanel
  const availableModels = providers.flatMap((p) =>
    p.models.map((m) => `${p.providerID}/${m.modelID}`)
  );

  return (
    <ModelFilterPanel
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className="shrink-0 h-8 w-8 flex items-center justify-center border border-input bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          title="Configure visible models"
          aria-label="Configure visible models"
        >
          <SlidersHorizontal size={12} />
        </button>
      }
      availableModels={availableModels}
      filter={filter.filter ?? null}
      onFilterChange={(hiddenModels, hiddenProviders) =>
        void filter.setFilter(hiddenModels, hiddenProviders)
      }
    />
  );
}
