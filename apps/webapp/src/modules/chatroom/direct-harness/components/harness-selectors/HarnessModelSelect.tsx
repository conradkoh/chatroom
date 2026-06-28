'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { getSelectedModelLabel, hasVisibleProviders } from './harness-model-select-utils';
import { HarnessModelSelectList } from './HarnessModelSelectList';
import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';
import type { ProviderOption } from './types';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { selectTriggerClassName } from '../ui/select';

import { cn } from '@/lib/utils';

interface HarnessModelSelectProps {
  providers: ProviderOption[];
  value: string; // "<providerID>::<modelID>"
  onValueChange: (v: string) => void;
  /**
   * Optional filter predicate. When provided, models for which `isHidden(key)`
   * returns true are excluded from the dropdown. Key format: "providerID::modelID".
   * Provider groups with no visible models are omitted entirely.
   * The currently-selected model's label still shows in the trigger even if hidden.
   */
  isHidden?: (modelKey: string) => boolean;
}

// fallow-ignore-next-line complexity
export function HarnessModelSelect({
  providers,
  value,
  onValueChange,
  isHidden,
}: HarnessModelSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedLabel = getSelectedModelLabel(providers, value);
  const hasProviders = hasVisibleProviders(providers, isHidden);
  const triggerLabel = selectedLabel ?? (hasProviders ? 'Select model…' : 'No models yet');

  return (
    <Popover
      open={hasProviders ? open : false}
      onOpenChange={hasProviders ? setOpen : undefined}
      modal={false}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!hasProviders}
          className={cn(selectTriggerClassName, 'w-full h-8')}
          title={hasProviders ? 'Select model' : CAPABILITIES_REFRESH_HINT}
          aria-label={hasProviders ? 'Select model' : 'No models available yet'}
        >
          <span
            className={cn('truncate text-left flex-1', !selectedLabel && 'text-muted-foreground')}
          >
            {triggerLabel}
          </span>
          <ChevronDown size={12} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72" align="start">
        <HarnessModelSelectList
          providers={providers}
          value={value}
          onValueChange={onValueChange}
          onClose={() => setOpen(false)}
          isHidden={isHidden}
        />
      </PopoverContent>
    </Popover>
  );
}
