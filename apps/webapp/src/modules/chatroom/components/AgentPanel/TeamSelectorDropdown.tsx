'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, ChevronDown } from 'lucide-react';
import { memo, useState } from 'react';

import type { TeamConfigEntry } from '../../hooks/use-team-configs';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  usePickerSearchState,
  filterPickerItems,
} from '../picker';

import { cn } from '@/lib/utils';

export interface TeamSelectorDropdownProps {
  teamName: string;
  teamId: string | undefined;
  defaultTeamId: string;
  teams: readonly TeamConfigEntry[];
  onTeamChange: (team: TeamConfigEntry) => Promise<void>;
}

/** Team picker — lives in its own row below the Agents header. Styled like AgentControls selects. */
export const TeamSelectorDropdown = memo(function TeamSelectorDropdown({
  teamName,
  teamId,
  defaultTeamId,
  teams,
  onTeamChange,
}: TeamSelectorDropdownProps) {
  const activeTeamId = teamId || defaultTeamId;
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);

  const filteredTeams = filterPickerItems(
    teams,
    searchTerm,
    (team) => `${team.name} ${team.roles.join(' ')}`
  );

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      title="Switch team"
      align="start"
      contentClassName="w-72"
      trigger={
        <button
          type="button"
          className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent flex items-center justify-between"
          title="Switch team"
        >
          <span className="truncate">{teamName}</span>
          <ChevronDown size={10} className="ml-1 flex-shrink-0 text-chatroom-text-muted" />
        </button>
      }
    >
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search teams…" />
      <PickerScrollBody maxHeightClassName="max-h-60">
        {filteredTeams.length === 0 ? (
          <p className="px-3 py-2 text-xs text-chatroom-text-muted">No teams found.</p>
        ) : (
          filteredTeams.map((teamData) => {
            const isActive = teamData.id === activeTeamId;
            return (
              <button
                key={teamData.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={async () => {
                  if (isActive) {
                    handleOpenChange(false);
                    return;
                  }
                  await onTeamChange(teamData);
                  handleOpenChange(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-chatroom-border last:border-b-0 transition-colors duration-100 flex items-center justify-between',
                  isActive ? 'bg-chatroom-accent/5' : 'hover:bg-chatroom-bg-hover'
                )}
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
                    {teamData.name}
                  </div>
                  <div className="text-[10px] text-chatroom-text-secondary mt-0.5">
                    {teamData.roles.join(' · ')}
                  </div>
                </div>
                {isActive ? (
                  <Check size={12} className="text-chatroom-accent ml-2 shrink-0" />
                ) : null}
              </button>
            );
          })
        )}
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
});

/** Builds the updateTeam mutation args from a team config entry. */
export function teamConfigToUpdateArgs(
  chatroomId: string,
  team: TeamConfigEntry
): {
  chatroomId: Id<'chatroom_rooms'>;
  teamId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint: string;
} {
  return {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    teamId: team.id,
    teamName: team.name,
    teamRoles: team.roles,
    teamEntryPoint: team.entryPoint || team.roles[0],
  };
}
