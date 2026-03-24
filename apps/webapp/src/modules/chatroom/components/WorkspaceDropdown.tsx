'use client';

import { memo } from 'react';

import type { WorkspaceGroup } from '../types/workspace';
import { ALL_WORKSPACES } from '../hooks/useWorkspaceSelection';

export { ALL_WORKSPACES };

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Component ──────────────────────────────────────────────────────────

interface WorkspaceDropdownProps {
  workspaceGroups: WorkspaceGroup[];
  selectedWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  /** When true, shows an "All Workspaces" option at the top. Defaults to true. */
  showAllOption?: boolean;
  /** Total number of agents (shown in "All Workspaces" label). */
  totalAgents?: number;
}

/**
 * Dropdown workspace selector — renders workspaces grouped by machine.
 * Shared between Settings > Workspaces and the All Agents modal.
 */
export const WorkspaceDropdown = memo(function WorkspaceDropdown({
  workspaceGroups,
  selectedWorkspaceId,
  onSelectWorkspace,
  showAllOption = true,
  totalAgents,
}: WorkspaceDropdownProps) {
  return (
    <Select value={selectedWorkspaceId} onValueChange={onSelectWorkspace}>
      <SelectTrigger size="sm" className="w-full text-xs">
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent>
        {showAllOption && (
          <SelectItem value={ALL_WORKSPACES}>
            All Workspaces{totalAgents != null ? ` (${totalAgents})` : ''}
          </SelectItem>
        )}
        {workspaceGroups.map((group) => (
          <SelectGroup key={group.machineId ?? group.hostname}>
            <SelectLabel>{group.hostname}</SelectLabel>
            {group.workspaces.map((ws) => {
              const dirLabel = ws.workingDir
                ? (ws.workingDir.split('/').filter(Boolean).pop() ?? ws.workingDir)
                : 'Unassigned';
              return (
                <SelectItem key={ws.id} value={ws.id}>
                  {dirLabel} ({ws.agentRoles.length})
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
});
