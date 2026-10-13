'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useRef } from 'react';

import { useFocusFirstControl } from './useFocusFirstControl';
import {
  TeamSelectorDropdown,
  teamConfigToUpdateArgs,
} from '../../components/AgentPanel/TeamSelectorDropdown';
import { SetupAgentTeamStep } from '../../components/setup/SetupAgentTeamStep';
import { setupSecondaryButtonClassName } from '../../components/setup/SetupStepLayout';
import { SetupWorkspaceLoadingPanel } from '../../components/setup/SetupWorkspaceLoadingPanel';
import { useTeamConfigs, type TeamConfigEntry } from '../../hooks/use-team-configs';
import { useAgentCommandSender } from '../../hooks/useAgentCommandSender';
import { useAgentConfigs } from '../../hooks/useAgentConfigs';
import { useChatroomTeam } from '../../hooks/useChatroomTeam';
import type { UserMachine } from '../../types/machine';

interface NewChatroomAgentsStepProps {
  chatroomId: string;
  machineId: string;
  workingDir: string;
  connectedMachines: UserMachine[];
  /** Runs for "Open chatroom" and once every agent has started. */
  onDone: () => void;
}

type ChatroomTeamState = ReturnType<typeof useChatroomTeam>;

/** Mounted once the team has loaded, so the focus effect runs against the rendered controls. */
function AgentsStepContent({
  team,
  chatroomId,
  machineId,
  workingDir,
  connectedMachines,
  onDone,
}: NewChatroomAgentsStepProps & { team: ChatroomTeamState }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusFirstControl(bodyRef);

  const { configs: agentConfigs } = useAgentConfigs(chatroomId, { enabled: true });
  const sendCommand = useAgentCommandSender();
  const { teams, defaultTeamId } = useTeamConfigs();
  const updateTeam = useSessionMutation(api.chatrooms.updateTeam);

  const handleTeamChange = useCallback(
    async (nextTeam: TeamConfigEntry) => {
      await updateTeam(teamConfigToUpdateArgs(chatroomId, nextTeam));
    },
    [updateTeam, chatroomId]
  );

  return (
    <SetupAgentTeamStep
      bodyRef={bodyRef}
      bodyStart={
        <TeamSelectorDropdown
          teamName={team.teamName ?? ''}
          teamId={team.teamId}
          defaultTeamId={defaultTeamId}
          teams={teams}
          onTeamChange={handleTeamChange}
        />
      }
      footerSecondary={
        <button type="button" onClick={onDone} className={setupSecondaryButtonClassName}>
          Open chatroom
        </button>
      }
      chatroomId={chatroomId}
      teamId={team.teamId}
      teamRoles={team.teamRoles}
      teamEntryPoint={team.entryPoint}
      participants={[]}
      machineId={machineId}
      workingDir={workingDir}
      machines={connectedMachines}
      isLoadingMachines={false}
      agentConfigs={agentConfigs}
      sendCommand={sendCommand}
      onAllAgentsStarted={onDone}
      onStartRequested={onDone}
    />
  );
}

/**
 * Step 3: configure and start the team's agents. The chatroom already exists at this point, so
 * the only exit is "Open chatroom". Cancel is not offered.
 */
export function NewChatroomAgentsStep(props: NewChatroomAgentsStepProps) {
  const team = useChatroomTeam(props.chatroomId);
  if (team.isLoading) {
    return <SetupWorkspaceLoadingPanel label="Loading team..." />;
  }
  return <AgentsStepContent {...props} team={team} />;
}
