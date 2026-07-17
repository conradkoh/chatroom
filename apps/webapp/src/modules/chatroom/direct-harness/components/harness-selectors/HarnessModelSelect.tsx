'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { getSelectedModelLabel, hasVisibleProviders } from './harness-model-select-utils';
import { HarnessModelSelectList } from './HarnessModelSelectList';
import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';
import type { ProviderOption } from './types';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  usePickerSearchState,
} from '../../../components/picker';
import {
  pickerTriggerClassName,
  pickerTriggerChevronClassName,
  PICKER_TRIGGER_CHEVRON_SIZE,
} from '../../../components/picker/pickerTriggerStyles';

interface HarnessModelSelectProps {
  providers: ProviderOption[];
  value: string;
  onValueChange: (v: string) => void;
  isHidden?: (modelKey: string) => boolean;
  disabled?: boolean;
}

// fallow-ignore-next-line complexity
export function HarnessModelSelect({
  providers,
  value,
  onValueChange,
  isHidden,
  disabled = false,
}: HarnessModelSelectProps) {
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);
  const selectedLabel = getSelectedModelLabel(providers, value);
  const hasProviders = hasVisibleProviders(providers, isHidden);
  const isDisabled = !hasProviders || disabled;
  const triggerLabel = selectedLabel ?? (hasProviders ? 'Model...' : 'No models yet');

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      disabled={isDisabled}
      title="Select model"
      align="start"
      contentClassName="w-72"
      trigger={
        <button
          type="button"
          disabled={isDisabled}
          className={pickerTriggerClassName}
          title={hasProviders ? 'Select model' : CAPABILITIES_REFRESH_HINT}
          aria-label={hasProviders ? 'Select model' : 'No models available yet'}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown
            size={PICKER_TRIGGER_CHEVRON_SIZE}
            className={pickerTriggerChevronClassName}
          />
        </button>
      }
    >
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search models…" />
      <PickerScrollBody maxHeightClassName="max-h-60">
        <HarnessModelSelectList
          providers={providers}
          value={value}
          onValueChange={onValueChange}
          onClose={() => handleOpenChange(false)}
          isHidden={isHidden}
          searchTerm={searchTerm}
        />
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
