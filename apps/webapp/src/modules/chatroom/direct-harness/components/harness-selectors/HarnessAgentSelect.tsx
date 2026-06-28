'use client';

import { displayAgentRoleName, getEligibleAgents } from './display-agent-role';
import { CAPABILITIES_REFRESH_HINT, PENDING_SELECT_VALUE } from './select-empty-states';
import type { AgentOption } from './types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface HarnessAgentSelectProps {
  /** Full agents list — component filters to mode primary|all internally. */
  agents: AgentOption[];
  value: string;
  onValueChange: (v: string) => void;
  /**
   * The resolved fallback agent name (e.g. 'builder') shown when no agents
   * have been discovered yet (harness cold start). Displayed as "default" for
   * single-role harnesses.
   */
  resolvedAgent: string;
}

export function HarnessAgentSelect({
  agents,
  value,
  onValueChange,
  resolvedAgent,
}: HarnessAgentSelectProps) {
  const eligibleAgents = getEligibleAgents(agents);
  const hasAgents = eligibleAgents.length > 0;
  const pendingLabel = displayAgentRoleName(agents, resolvedAgent || 'builder');

  return (
    <Select
      value={hasAgents ? value : PENDING_SELECT_VALUE}
      onValueChange={hasAgents ? onValueChange : undefined}
      disabled={!hasAgents}
    >
      {/* bg-transparent overrides dark:bg-input/30 from base SelectTrigger for visual consistency */}
      <SelectTrigger
        size="sm"
        className="text-xs w-full bg-transparent"
        title={!hasAgents ? CAPABILITIES_REFRESH_HINT : undefined}
      >
        <SelectValue placeholder={pendingLabel} />
      </SelectTrigger>
      <SelectContent>
        {hasAgents ? (
          eligibleAgents.map((a) => (
            <SelectItem key={a.name} value={a.name} className="text-xs">
              {displayAgentRoleName(agents, a.name)}
            </SelectItem>
          ))
        ) : (
          <SelectItem
            value={PENDING_SELECT_VALUE}
            disabled
            className="text-xs text-muted-foreground"
          >
            {pendingLabel}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
