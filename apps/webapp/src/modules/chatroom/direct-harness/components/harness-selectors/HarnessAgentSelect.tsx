'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { AgentOption } from './types';

interface HarnessAgentSelectProps {
  /** Full agents list — component filters to mode primary|all internally. */
  agents: AgentOption[];
  value: string;
  onValueChange: (v: string) => void;
  /**
   * The resolved fallback agent name (e.g. 'builder') shown when no agents
   * have been discovered yet (harness cold start). This keeps the trigger
   * visually consistent instead of reverting to the free-text input.
   */
  resolvedAgent: string;
}

export function HarnessAgentSelect({
  agents,
  value,
  onValueChange,
  resolvedAgent,
}: HarnessAgentSelectProps) {
  const eligibleAgents = agents.filter((a) => a.mode === 'primary' || a.mode === 'all');
  const hasAgents = eligibleAgents.length > 0;

  return (
    <Select
      value={hasAgents ? value : resolvedAgent}
      onValueChange={hasAgents ? onValueChange : undefined}
      disabled={!hasAgents}
    >
      {/* bg-transparent overrides dark:bg-input/30 from base SelectTrigger for visual consistency */}
      <SelectTrigger
        className="h-8 text-xs w-full bg-transparent"
        title={
          !hasAgents ? 'Agent list will populate after the first session starts.' : undefined
        }
      >
        <SelectValue placeholder={resolvedAgent || 'Agent'} />
      </SelectTrigger>
      {hasAgents && (
        <SelectContent>
          {eligibleAgents.map((a) => (
            <SelectItem key={a.name} value={a.name} className="text-xs">
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      )}
    </Select>
  );
}
