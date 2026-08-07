import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { startAgentsBatch } from './agentStart';
import type { AgentConfig, SendCommandFn } from '../types/machine';

export async function startAgentsForRoles(
  agentRoles: string[],
  roleConfigMap: Map<string, AgentConfig>,
  chatroomId: Id<'chatroom_rooms'>,
  sendCommand: SendCommandFn
): Promise<PromiseSettledResult<unknown>[]> {
  return startAgentsBatch(
    agentRoles,
    (role) => {
      const config = roleConfigMap.get(role.toLowerCase());
      if (!config) return null;
      return {
        machineId: config.machineId,
        chatroomId,
        role,
        model: config.model ?? '',
        agentHarness: config.agentType,
        workingDir: config.workingDir,
        wantResume: config.wantResume,
      };
    },
    sendCommand
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
  sendCommand: SendCommandFn,
  onComplete: (failed: string[]) => void
): Promise<void> {
  const results = await startAgentsForRoles(agentRoles, roleConfigMap, chatroomId, sendCommand);
  onComplete(getFailedAgentRoles(results, agentRoles));
}
