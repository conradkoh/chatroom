'use client';

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentOption {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  model?: { providerID: string; modelID: string };
  description?: string;
}

export interface ProviderOption {
  providerID: string;
  name: string;
  models: { modelID: string; name: string }[];
}

interface HarnessAgentSelectProps {
  agents: AgentOption[];
  value: string;
  onValueChange: (v: string) => void;
}

interface HarnessModelSelectProps {
  providers: ProviderOption[];
  value: string; // "<providerID>::<modelID>"
  onValueChange: (v: string) => void;
}

// ─── HarnessAgentSelect ───────────────────────────────────────────────────────

export function HarnessAgentSelect({ agents, value, onValueChange }: HarnessAgentSelectProps) {
  const eligibleAgents = agents.filter((a) => a.mode === 'primary' || a.mode === 'all');

  if (eligibleAgents.length === 0) {
    // No agents discovered yet — harness hasn't booted.
    // Show a text input so the user can type an agent name (default: "builder").
    return (
      <div className="space-y-1">
        <Input
          className="h-8 text-xs bg-background border-border"
          placeholder="builder"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">
          Agent list will populate after the first session starts.
        </p>
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 text-xs bg-background border-border">
        <SelectValue placeholder="Select agent" />
      </SelectTrigger>
      <SelectContent className="bg-card border-border text-foreground">
        {eligibleAgents.map((a) => (
          <SelectItem key={a.name} value={a.name} className="text-xs">
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── HarnessModelSelect ───────────────────────────────────────────────────────

export function HarnessModelSelect({ providers, value, onValueChange }: HarnessModelSelectProps) {
  const [open, setOpen] = useState(false);

  // Build a flat display label from the selected key
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
      <PopoverTrigger asChild className="flex-1">
        <button
          type="button"
          disabled={!hasProviders}
          className={cn(
            'flex items-center justify-between w-full h-full gap-2 px-3 text-xs rounded-md border border-input bg-transparent',
            'shadow-xs whitespace-nowrap transition-[color,box-shadow]',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
          title="Select model"
        >
          <span className="truncate text-left">
            {selectedLabel ?? (
              <span className="text-muted-foreground">Default model</span>
            )}
          </span>
          <ChevronDown size={12} className="ml-1 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-72"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search models…" className="text-xs h-8" />
          <CommandList className="max-h-60">
            <CommandEmpty className="text-xs text-muted-foreground py-3 text-center">
              No models found.
            </CommandEmpty>
            {providers.map((provider) => (
              <CommandGroup key={provider.providerID} heading={provider.name}>
                {provider.models.map((model) => {
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
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a "<providerID>::<modelID>" key into model object or undefined. */
export function parseModelKey(
  key: string | undefined
): { providerID: string; modelID: string } | undefined {
  if (!key) return undefined;
  const [providerID, modelID] = key.split('::');
  if (providerID && modelID) return { providerID, modelID };
  return undefined;
}

/** Build a "<providerID>::<modelID>" key from a model object. */
export function buildModelKey(model?: { providerID: string; modelID: string }): string {
  if (!model) return '';
  return `${model.providerID}::${model.modelID}`;
}
