'use client';

import { AlertCircle, ChevronDown } from 'lucide-react';

import type { ModelFilterState } from './types';

export interface ModelPickerMetaProps {
  isSelectedModelHidden: boolean;
  filter?: ModelFilterState | null;
  showChevron?: boolean;
  chevronSize?: number;
}

export function ModelPickerMeta({
  isSelectedModelHidden,
  filter,
  showChevron,
  chevronSize = 10,
}: ModelPickerMetaProps) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {isSelectedModelHidden && (
        <AlertCircle
          size={10}
          className="text-chatroom-status-warning flex-shrink-0"
          aria-label="Selected model is hidden by filter — choose a new model"
        />
      )}
      {filter && (filter.hiddenModels.length > 0 || filter.hiddenProviders.length > 0) && (
        <div className="w-1.5 h-1.5 bg-chatroom-accent" title="Some models are hidden" />
      )}
      {showChevron && <ChevronDown size={chevronSize} className="text-chatroom-text-muted" />}
    </div>
  );
}
