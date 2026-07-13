'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { getSelectedModelLabel, hasVisibleProviders } from './harness-model-select-utils';
import { HarnessModelSelectList } from './HarnessModelSelectList';
import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';
import type { ProviderOption } from './types';
import { ResponsivePickerShell, PickerScrollBody } from '../../../components/picker';
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
    <ResponsivePickerShell
      open={open}
      onOpenChange={setOpen}
      disabled={!hasProviders}
      title="Select model"
      align="start"
      contentClassName="w-72"
      trigger={
        <button
          type="button"
          disabled={!hasProviders}
          className={selectTriggerClassName}
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
      }
    >
      <PickerScrollBody maxHeightClassName="max-h-60">
        <HarnessModelSelectList
          providers={providers}
          value={value}
          onValueChange={onValueChange}
          onClose={() => setOpen(false)}
          isHidden={isHidden}
        />
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
