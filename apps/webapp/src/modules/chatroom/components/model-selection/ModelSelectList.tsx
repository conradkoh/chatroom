'use client';

import { useMemo } from 'react';

import type { ModelGroup } from './types';
import { PickerOptionRow, filterPickerItems } from '../../components/picker';

export interface ModelSelectListProps {
  groups: ModelGroup[];
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  isHidden?: (value: string) => boolean;
  searchTerm: string;
  allowDeselect?: boolean;
  emptyMessage?: string;
}

export function ModelSelectList({
  groups,
  value,
  onValueChange,
  onClose,
  isHidden,
  searchTerm,
  allowDeselect = true,
  emptyMessage = 'No models found.',
}: ModelSelectListProps) {
  const filtered = useMemo(() => {
    return groups
      .map((group) => {
        const visibleOptions = isHidden
          ? group.options.filter((o) => !isHidden(o.value))
          : group.options;
        const searched = filterPickerItems(
          visibleOptions,
          searchTerm,
          (option) => `${group.providerLabel} ${option.label}`
        );
        return { ...group, options: searched };
      })
      .filter((group) => group.options.length > 0);
  }, [groups, isHidden, searchTerm]);

  if (filtered.length === 0) {
    return <p className="px-3 py-2 text-xs text-chatroom-text-muted">{emptyMessage}</p>;
  }

  return (
    <>
      {filtered.map((group) => (
        <div key={group.providerKey}>
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            {group.providerLabel}
          </p>
          {group.options.map((option) => {
            const isSelected = value === option.value;
            return (
              <PickerOptionRow
                key={option.value}
                selected={isSelected}
                onSelect={() => {
                  onValueChange(isSelected && allowDeselect ? '' : option.value);
                  onClose();
                }}
              >
                {option.label}
              </PickerOptionRow>
            );
          })}
        </div>
      ))}
    </>
  );
}
