'use client';

import { Check } from 'lucide-react';
import { useMemo } from 'react';

import { getVisibleModels, modelKey } from './harness-model-select-utils';
import type { ProviderOption } from './types';
import { PickerOptionRow, filterPickerItems } from '../../../components/picker';

interface HarnessModelSelectListProps {
  providers: ProviderOption[];
  value: string;
  onValueChange: (v: string) => void;
  onClose: () => void;
  isHidden?: (modelKey: string) => boolean;
  searchTerm: string;
}

export function HarnessModelSelectList({
  providers,
  value,
  onValueChange,
  onClose,
  isHidden,
  searchTerm,
}: HarnessModelSelectListProps) {
  const grouped = useMemo(() => {
    return providers
      .map((provider) => {
        const visibleModels = getVisibleModels(provider, isHidden);
        const filteredModels = filterPickerItems(
          visibleModels,
          searchTerm,
          (model) => `${provider.name} ${model.name}`
        );
        return {
          providerID: provider.providerID,
          providerName: provider.name,
          models: filteredModels,
        };
      })
      .filter((group) => group.models.length > 0);
  }, [providers, isHidden, searchTerm]);

  if (grouped.length === 0) {
    return <p className="px-3 py-2 text-xs text-chatroom-text-muted">No models found.</p>;
  }

  return (
    <>
      {grouped.map(({ providerID, providerName, models }) => (
        <div key={providerID}>
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            {providerName}
          </p>
          {models.map((model) => {
            const key = modelKey(providerID, model.modelID);
            const isSelected = value === key;
            return (
              <PickerOptionRow
                key={key}
                selected={isSelected}
                onSelect={() => {
                  onValueChange(isSelected ? '' : key);
                  onClose();
                }}
              >
                <span className="truncate">{model.name}</span>
                {isSelected && <Check size={12} className="ml-2 shrink-0 text-primary" />}
              </PickerOptionRow>
            );
          })}
        </div>
      ))}
    </>
  );
}
