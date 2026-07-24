'use client';

import { ModelGroupedList } from './ModelGroupedList';
import type { ModelGroup } from './types';

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
  return (
    <ModelGroupedList
      mode="select"
      groups={groups}
      value={value}
      onValueChange={onValueChange}
      onClose={onClose}
      isHidden={isHidden}
      searchTerm={searchTerm}
      allowDeselect={allowDeselect}
      emptyMessage={emptyMessage}
    />
  );
}
