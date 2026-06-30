'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, ChevronDown } from 'lucide-react';
import { memo } from 'react';

import type { TeamConfigEntry } from '../../hooks/use-team-configs';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent flex items-center justify-between"
          title="Switch team"
        >
          <span className="truncate">{teamName}</span>
          <ChevronDown size={10} className="ml-1 flex-shrink-0 text-chatroom-text-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[200px] bg-chatroom-bg-primary border border-chatroom-border p-0 rounded-none"
      >
        {teams.map((teamData) => {
          const isActive = teamData.id === activeTeamId;
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
                  : 'text-chatroom-text-primary hover:bg-chatroom-bg-hover'
              }`}
            >
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary">
                  {teamData.name}
                </div>
                <div className="text-[10px] text-chatroom-text-secondary mt-0.5">
                  {teamData.roles.join(' · ')}
                </div>
              </div>
              {isActive && <Check size={12} className="text-chatroom-accent ml-2 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
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
