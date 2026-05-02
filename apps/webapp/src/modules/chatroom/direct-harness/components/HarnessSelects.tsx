'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    return (
      <div className="text-xs text-muted-foreground py-1">
        No agents available for this harness.
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
  const modelOptions: { value: string; label: string }[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      modelOptions.push({
        value: `${provider.providerID}::${model.modelID}`,
        label: `${provider.name} · ${model.name}`,
      });
    }
  }

  if (modelOptions.length === 0) {
    return <div className="text-xs text-muted-foreground py-1">No models available.</div>;
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 text-xs bg-background border-border">
        <SelectValue placeholder="Use agent default" />
      </SelectTrigger>
      <SelectContent className="bg-card border-border text-foreground">
        {modelOptions.map((m) => (
          <SelectItem key={m.value} value={m.value} className="text-xs">
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
