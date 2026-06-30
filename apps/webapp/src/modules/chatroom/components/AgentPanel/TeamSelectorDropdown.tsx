'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, ChevronDown } from 'lucide-react';
import { memo } from 'react';

import type { TeamConfigEntry } from '../../hooks/use-team-configs';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface TeamSelectorDropdownProps {
  teamName: string;
  teamId: string | undefined;
  defaultTeamId: string;
  teams: readonly TeamConfigEntry[];
  onTeamChange: (team: TeamConfigEntry) => Promise<void>;
}

/** Team picker moved from the app header into the agents sidebar. */
export const TeamSelectorDropdown = memo(function TeamSelectorDropdown({
  teamName,
  teamId,
  defaultTeamId,
  teams,
  onTeamChange,
}: TeamSelectorDropdownProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="bg-chatroom-bg-tertiary border-2 border-transparent px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-secondary flex items-center gap-1 cursor-pointer transition-all duration-100 hover:border-chatroom-border hover:text-chatroom-text-primary focus:outline-none max-w-full"
          title="Switch team"
        >
          <span className="truncate">Team: {teamName}</span>
          <ChevronDown size={10} className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[200px] bg-chatroom-bg-tertiary border-2 border-chatroom-border rounded-none p-0"
      >
        {teams.map((teamData) => {
          const isActive = teamData.id === (teamId || defaultTeamId);
          return (
            <DropdownMenuItem
              key={teamData.id}
              onClick={async () => {
                if (isActive) return;
                await onTeamChange(teamData);
              }}
              className={`flex items-center justify-between px-3 py-2.5 cursor-pointer border-b border-chatroom-border last:border-b-0 rounded-none transition-colors duration-100 ${
                isActive
                  ? 'bg-chatroom-accent/5 text-chatroom-text-primary'
                  : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary'
              }`}
            >
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
                  {teamData.name}
                </div>
                <div className="text-[10px] text-chatroom-text-muted mt-0.5">
                  {teamData.roles.join(' · ')}
                </div>
              </div>
              {isActive && <Check size={12} className="text-chatroom-accent ml-2 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="bg-chatroom-border-strong m-0" />
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Agents must reconnect after switching
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
