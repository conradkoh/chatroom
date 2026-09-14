import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { TeamStructure } from '@workspace/shared/domain/team-presets';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

export interface ChatroomTeam {
  structure: TeamStructure | null | undefined;
  teamId: string | undefined;
  teamName: string | undefined;
  teamRoles: string[];
  entryPoint: string | undefined;
  isLoading: boolean;
}

/**
 * Resolves the current team for a chatroom from the active team assignment.
 * Runtime agent state and the deprecated chatroom room fields are deliberately
 * not consulted here.
 */
export function useChatroomTeam(chatroomId: string): ChatroomTeam {
  const structure = useSessionQuery(api.chatrooms.getTeamStructureForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  return useMemo(
    () => ({
      structure,
      teamId: structure?.teamId,
      teamName: structure?.teamName,
      teamRoles: structure?.roles.map(({ role }) => role) ?? [],
      entryPoint: structure?.entryPoint,
      isLoading: structure === undefined,
    }),
    [structure]
  );
}
