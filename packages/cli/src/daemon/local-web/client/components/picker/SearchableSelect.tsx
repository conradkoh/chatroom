import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { filterPickerItems } from './filterPickerItems';
import { PickerOptionRow } from './PickerOptionRow';
import { PickerScrollBody } from './PickerScrollBody';
import { PickerSearch } from './PickerSearch';
import {
  filterSelectTriggerClassName,
  filterSelectTriggerChevronClassName,
} from './pickerTriggerStyles';
import { usePickerSearchState } from './usePickerSearchState';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type SearchableSelectOption = { value: string; label: string };
export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value?: string;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  placeholder?: string;
  allLabel?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  ariaLabel: string;
  triggerClassName?: string;
  contentClassName?: string;
  allowClear?: boolean;
}
export function SearchableSelect({
  options,
  value,
  onChange,
  disabled,
  isLoading,
  isError,
  placeholder = 'Select…',
  allLabel = 'All',
  searchPlaceholder = 'Search…',
  emptyLabel = 'No results',
  ariaLabel,
  triggerClassName,
  contentClassName,
  allowClear = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);
  const selectedLabel = options.find((o) => o.value === value)?.label;
  const triggerText = isLoading
    ? 'Loading…'
    : isError
      ? 'Failed to load'
      : (selectedLabel ?? placeholder);
  const filtered = useMemo(
    () => filterPickerItems(options, searchTerm, (o) => `${o.label} ${o.value}`),
    [options, searchTerm]
  );
  const isDisabled = disabled || isLoading || isError;
  const trigger = (
    <button
      type="button"
      disabled={isDisabled}
      className={cn(filterSelectTriggerClassName, triggerClassName)}
      aria-label={ariaLabel}
      aria-busy={isLoading}
    >
      <span className="truncate">{triggerText}</span>
      <ChevronDown size={12} className={filterSelectTriggerChevronClassName} />
    </button>
  );
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent className={cn('w-64', contentClassName)}>
        <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder={searchPlaceholder} />
        <PickerScrollBody maxHeightClassName="max-h-60">
          {allowClear && (
            <PickerOptionRow
              selected={!value}
              onSelect={() => {
                onChange(undefined);
                handleOpenChange(false);
              }}
            >
              {allLabel}
            </PickerOptionRow>
          )}
          {filtered.map((o) => (
            <PickerOptionRow
              key={o.value}
              selected={value === o.value}
              onSelect={() => {
                onChange(o.value);
                handleOpenChange(false);
              }}
            >
              {o.label}
            </PickerOptionRow>
          ))}
          {!filtered.length && (
            <div className="px-3 py-2 text-xs text-chatroom-text-muted">{emptyLabel}</div>
          )}
        </PickerScrollBody>
      </PopoverContent>
    </Popover>
  );
}
