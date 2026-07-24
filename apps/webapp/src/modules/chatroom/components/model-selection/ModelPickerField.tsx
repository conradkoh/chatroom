'use client';

import { MODEL_PICKER_PANEL_WIDTH } from './constants';
import { ModelFilterButton } from './ModelFilterButton';
import { ModelSelect } from './ModelSelect';
import type { ModelSelectTriggerVariant } from './types';
import { useHarnessModelPicker } from './useHarnessModelPicker';

import { cn } from '@/lib/utils';

export interface ModelPickerFieldProps {
  machineId: string | null | undefined;
  harness: string | null | undefined;
  availableModels: string[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  triggerVariant?: ModelSelectTriggerVariant;
  allowDeselect?: boolean;
  placeholder?: string;
  filterButtonVariant?: 'harness' | 'chatroom';
  className?: string;
}

export function ModelPickerField({
  machineId,
  harness,
  availableModels,
  value,
  onValueChange,
  disabled = false,
  triggerVariant = 'chatroom',
  allowDeselect = false,
  placeholder,
  filterButtonVariant,
  className,
}: ModelPickerFieldProps) {
  const { modelFilter, modelGroups, isSelectedModelHidden } = useHarnessModelPicker({
    machineId,
    harness,
    availableModels,
    selectedModel: value,
  });

  const resolvedPlaceholder =
    placeholder ?? (!harness ? 'Select a harness first' : 'Select a model');

  const resolvedFilterVariant =
    filterButtonVariant ?? (triggerVariant === 'chatroom' ? 'chatroom' : 'harness');

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 min-w-0">
        <ModelSelect
          groups={modelGroups}
          value={value}
          onValueChange={onValueChange}
          isHidden={modelFilter.isHidden}
          disabled={disabled || !harness}
          triggerVariant={triggerVariant}
          contentClassName={MODEL_PICKER_PANEL_WIDTH}
          selectedHidden={isSelectedModelHidden}
          filter={modelFilter.filter}
          allowDeselect={allowDeselect}
          placeholder={resolvedPlaceholder}
        />
      </div>
      {harness && (
        <ModelFilterButton
          filter={modelFilter}
          availableModels={availableModels}
          disabled={disabled}
          variant={resolvedFilterVariant}
        />
      )}
    </div>
  );
}
