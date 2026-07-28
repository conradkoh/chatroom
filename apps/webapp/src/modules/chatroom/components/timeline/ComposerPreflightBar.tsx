'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { PlannerEnhancerToggle } from '../../features/enhancers/components/PlannerEnhancerToggle';
import { teamSupportsEnhancer } from '../../hooks/persistence/messageViewMode';
import { useAgentPanelData } from '../../hooks/useAgentPanelData';
import { useChatroomLifecycle } from '../../hooks/useChatroomLifecycle';
import { StandingInstructionsBar } from '../StandingInstructionsBar';

export function ComposerPreflightBar({ chatroomId }: { chatroomId: Id<'chatroom_rooms'> }) {
  const { activeWorkspace } = useChatroomLifecycle(chatroomId);
  const { teamRoles, isLoading } = useAgentPanelData(chatroomId);

  const teamSupportState = isLoading
    ? 'loading'
    : teamSupportsEnhancer(teamRoles)
      ? 'supported'
      : 'unsupported';

  return (
    <div
      className="flex items-stretch w-full border-b border-chatroom-border"
      data-testid="composer-preflight-bar"
    >
      <div className="flex-1 min-w-0 flex items-stretch">
        <StandingInstructionsBar chatroomId={chatroomId} />
      </div>
      <div className="shrink-0 border-l border-chatroom-border flex items-stretch min-w-[7rem]">
        <PlannerEnhancerToggle
          chatroomId={chatroomId}
          machineId={activeWorkspace?.machineId ?? null}
          teamSupportState={teamSupportState}
        />
      </div>
    </div>
  );
}
