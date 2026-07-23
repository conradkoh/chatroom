'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { findModelLabel, hasVisibleModels } from './modelGroups';
import { ModelPickerMeta } from './ModelPickerMeta';
import { ModelSelectList } from './ModelSelectList';
import type { ModelGroup, ModelSelectTriggerVariant, ModelFilterState } from './types';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  usePickerSearchState,
} from '../picker';
import {
  pickerTriggerClassName,
  pickerTriggerChevronClassName,
  PICKER_TRIGGER_CHEVRON_SIZE,
} from '../picker/pickerTriggerStyles';

export interface ModelSelectProps {
  groups: ModelGroup[];
  value: string;
  onValueChange: (value: string) => void;
  isHidden?: (value: string) => boolean;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  contentClassName?: string;
  triggerVariant?: ModelSelectTriggerVariant;
  selectedHidden?: boolean;
  filter?: ModelFilterState | null;
  allowDeselect?: boolean;
  emptyLabel?: string;
}

export function ModelSelect({
  groups,
  value,
  onValueChange,
  isHidden,
  disabled = false,
  placeholder,
  title = 'Select model',
  contentClassName,
  triggerVariant = 'harness',
  selectedHidden = false,
  filter,
  allowDeselect = true,
  emptyLabel,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);

  const selectedLabel = findModelLabel(groups, value);
  const anyVisible = hasVisibleModels(groups, isHidden);
  const isDisabled = !anyVisible || disabled;
  const triggerLabel =
    selectedLabel ?? placeholder ?? (anyVisible ? 'Model...' : (emptyLabel ?? 'No models yet'));

  const trigger =
    triggerVariant === 'harness' ? (
      <button
        type="button"
        disabled={isDisabled}
        className={pickerTriggerClassName}
        title={anyVisible ? 'Select model' : 'No models available yet'}
        aria-label={anyVisible ? 'Select model' : 'No models available yet'}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown size={PICKER_TRIGGER_CHEVRON_SIZE} className={pickerTriggerChevronClassName} />
      </button>
    ) : (
      <button
        type="button"
        disabled={isDisabled}
        className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto cursor-pointer hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
        title={anyVisible ? 'Select model' : 'No models available yet'}
        aria-label={anyVisible ? 'Select model' : 'No models available yet'}
      >
        <span className="truncate">{triggerLabel}</span>
        <ModelPickerMeta
          isSelectedModelHidden={selectedHidden}
          filter={filter}
          showChevron
          chevronSize={10}
        />
      </button>
    );

  const resolvedContentClassName =
    contentClassName ?? (triggerVariant === 'harness' ? 'w-72' : undefined);

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      disabled={isDisabled}
      title={title}
      align="start"
      contentClassName={resolvedContentClassName}
      trigger={trigger}
    >
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search models…" />
      <PickerScrollBody maxHeightClassName="max-h-60">
        <ModelSelectList
          groups={groups}
          value={value}
          onValueChange={onValueChange}
          onClose={() => handleOpenChange(false)}
          isHidden={isHidden}
          searchTerm={searchTerm}
          allowDeselect={allowDeselect}
        />
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
