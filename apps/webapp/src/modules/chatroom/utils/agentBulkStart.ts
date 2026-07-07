import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { AgentConfig } from '../types/machine';

type StartAgentCommand = (command: {
  machineId: string;
  type: 'start-agent';
  payload: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    model: string;
    agentHarness: string;
    workingDir: string;
  };
}) => Promise<unknown>;

export async function startAgentsForRoles(
  agentRoles: string[],
  roleConfigMap: Map<string, AgentConfig>,
  chatroomId: Id<'chatroom_rooms'>,
  sendCommand: StartAgentCommand
): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(
    agentRoles.map((role) => {
      const config = roleConfigMap.get(role.toLowerCase());
      if (!config) return null;
      return sendCommand({
        machineId: config.machineId,
        type: 'start-agent',
        payload: {
          chatroomId,
          role,
          model: config.model,
          agentHarness: config.agentType,
          workingDir: config.workingDir,
        },
      });
    })
  );
}

export function getFailedAgentRoles(
  results: PromiseSettledResult<unknown>[],
  agentRoles: string[]
): string[] {
  return results
    .map((result, index) => (result.status === 'rejected' ? agentRoles[index] : null))
    .filter(Boolean) as string[];
}

function getMissingAgentRoles(
  agentRoles: string[],
  roleConfigMap: Map<string, AgentConfig>
): string[] {
  return agentRoles.filter((role) => !roleConfigMap.has(role.toLowerCase()));
}

export function ensureAgentRolesConfigured(
  agentRoles: string[],
  roleConfigMap: Map<string, AgentConfig>,
  onMissing: () => void
): boolean {
  if (getMissingAgentRoles(agentRoles, roleConfigMap).length > 0) {
    onMissing();
    return false;
  }
  return true;
}

export async function runAgentStartBatch(
  agentRoles: string[],
  roleConfigMap: Map<string, AgentConfig>,
  chatroomId: Id<'chatroom_rooms'>,
  sendCommand: StartAgentCommand,
  onComplete: (failed: string[]) => void
): Promise<void> {
  const results = await startAgentsForRoles(agentRoles, roleConfigMap, chatroomId, sendCommand);
  onComplete(getFailedAgentRoles(results, agentRoles));
}
