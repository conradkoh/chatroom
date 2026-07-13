'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { displayAgentRoleName, getEligibleAgents } from './display-agent-role';
import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';
import type { AgentOption } from './types';
import { selectTriggerClassName } from '../ui/select';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from '../../../components/picker';

import { cn } from '@/lib/utils';

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
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);
  const eligibleAgents = getEligibleAgents(agents);
  const hasAgents = eligibleAgents.length > 0;
  const pendingLabel = displayAgentRoleName(agents, resolvedAgent || 'builder');

  const selectedLabel = hasAgents ? displayAgentRoleName(agents, value) : pendingLabel;
  const isDisabled = !hasAgents;

  const filteredAgents = filterPickerItems(
    eligibleAgents,
    searchTerm,
    (a) => `${displayAgentRoleName(agents, a.name)} ${a.name}`
  );

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      disabled={isDisabled}
      title="Select agent"
      align="start"
      contentClassName="w-72"
      trigger={
        <button
          type="button"
          disabled={isDisabled}
          className={selectTriggerClassName}
          title={hasAgents ? 'Select agent' : CAPABILITIES_REFRESH_HINT}
          aria-label={hasAgents ? 'Select agent' : 'No agents available yet'}
        >
          <span className={cn('truncate text-left flex-1')}>{selectedLabel}</span>
          <ChevronDown size={12} className="shrink-0 opacity-50" />
        </button>
      }
    >
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search agents…" />
      <PickerScrollBody maxHeightClassName="max-h-60">
        {filteredAgents.length === 0 ? (
          <p className="px-3 py-2 text-xs text-chatroom-text-muted">No agents found.</p>
        ) : (
          filteredAgents.map((a) => (
            <PickerOptionRow
              key={a.name}
              selected={value === a.name}
              onSelect={() => {
                onValueChange(a.name);
                handleOpenChange(false);
              }}
            >
              {displayAgentRoleName(agents, a.name)}
            </PickerOptionRow>
          ))
        )}
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
