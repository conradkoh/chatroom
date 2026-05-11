'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { selectTriggerClassName } from '../ui/select';
import { cn } from '@/lib/utils';
import type { ProviderOption } from './types';

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

export function HarnessModelSelect({ providers, value, onValueChange, isHidden }: HarnessModelSelectProps) {
  const [open, setOpen] = useState(false);

  const selectedLabel = (() => {
    if (!value) return null;
    const [providerID, modelID] = value.split('::');
    const provider = providers.find((p) => p.providerID === providerID);
    const model = provider?.models.find((m) => m.modelID === modelID);
    if (!provider || !model) return null;
    return `${provider.name} / ${model.name}`;
  })();

  const hasProviders = providers.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        {/* Trigger styled identically to SelectTrigger: h-8, text-xs, border border-input */}
        <button
          type="button"
          disabled={!hasProviders}
          className={cn(selectTriggerClassName, 'w-full h-8')}
          title="Select model"
        >
          <span className="truncate text-left flex-1">
            {selectedLabel ?? <span className="text-muted-foreground">Default model</span>}
          </span>
          <ChevronDown size={12} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72" align="start">
        <Command>
          <CommandInput placeholder="Search models…" className="text-xs h-8" />
          <CommandList className="max-h-60">
            <CommandEmpty className="text-xs text-muted-foreground py-3 text-center">
              No models found.
            </CommandEmpty>
            {providers.map((provider) => {
              // Filter out hidden models for this provider
              const visibleModels = provider.models.filter((model) => {
                const key = `${provider.providerID}::${model.modelID}`;
                return !isHidden?.(key);
              });
              // Skip provider group entirely when all its models are hidden
              if (visibleModels.length === 0) return null;
              return (
                <CommandGroup key={provider.providerID} heading={provider.name}>
                  {visibleModels.map((model) => {
                    const key = `${provider.providerID}::${model.modelID}`;
                    const isSelected = value === key;
                    return (
                      <CommandItem
                        key={key}
                        value={`${provider.name} ${model.name}`}
                        onSelect={() => {
                          onValueChange(isSelected ? '' : key);
                          setOpen(false);
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
      </PopoverContent>
    </Popover>
  );
}
