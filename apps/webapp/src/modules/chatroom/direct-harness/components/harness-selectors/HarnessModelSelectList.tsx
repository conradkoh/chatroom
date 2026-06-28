'use client';

import { Check } from 'lucide-react';

import { getVisibleModels, modelKey } from './harness-model-select-utils';
import type { ProviderOption } from './types';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';

interface HarnessModelSelectListProps {
  providers: ProviderOption[];
  value: string;
  onValueChange: (v: string) => void;
  onClose: () => void;
  isHidden?: (modelKey: string) => boolean;
}

export function HarnessModelSelectList({
  providers,
  value,
  onValueChange,
  onClose,
  isHidden,
}: HarnessModelSelectListProps) {
  return (
    <Command>
      <CommandInput placeholder="Search models…" className="text-xs h-8" />
      <CommandList className="max-h-60">
        <CommandEmpty className="text-xs text-muted-foreground py-3 text-center">
          No models found.
        </CommandEmpty>
        {providers.map((provider) => {
          const visibleModels = getVisibleModels(provider, isHidden);
          if (visibleModels.length === 0) return null;
          return (
            <CommandGroup key={provider.providerID} heading={provider.name}>
              {visibleModels.map((model) => {
                const key = modelKey(provider.providerID, model.modelID);
                const isSelected = value === key;
                return (
                  <CommandItem
                    key={key}
                    value={`${provider.name} ${model.name}`}
                    onSelect={() => {
                      onValueChange(isSelected ? '' : key);
                      onClose();
                    }}
                    className="text-xs flex items-center justify-between"
                  >
                    <span className="truncate">{model.name}</span>
                    {isSelected && <Check size={12} className="ml-2 shrink-0 text-primary" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
    </Command>
  );
}
