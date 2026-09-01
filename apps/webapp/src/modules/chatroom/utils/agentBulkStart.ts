import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { startAgentsBatch, type StartAgentInput } from './agentStart';
import type { AgentRoleView } from '../hooks/useAgentPanelData';
import type { AgentConfig, SendCommandFn } from '../types/machine';

function codexMaxReasoningField(
  config: Pick<AgentConfig, 'agentType' | 'maxReasoningLevel'>
): Pick<StartAgentInput, 'maxReasoningLevel'> {
  return config.agentType === 'codex-sdk' && config.maxReasoningLevel !== undefined
    ? { maxReasoningLevel: config.maxReasoningLevel }
    : {};
}

function buildBulkStartInput(
  role: string,
  config: AgentConfig,
  chatroomId: Id<'chatroom_rooms'>
): StartAgentInput {
  return {
    machineId: config.machineId,
    chatroomId,
    role,
    model: config.model ?? '',
    agentHarness: config.agentType,
    workingDir: config.workingDir,
    ...codexMaxReasoningField(config),
  };
}

function buildBulkRestartPayload(
  role: string,
  config: AgentConfig,
  chatroomId: Id<'chatroom_rooms'>
) {
  return {
    chatroomId,
    role,
    model: config.model ?? '',
    agentHarness: config.agentType,
    workingDir: config.workingDir,
    ...codexMaxReasoningField(config),
  };
}

function resolveRequiredRestartFields(
  base: AgentConfig | undefined,
  agentView?: AgentRoleView
): { machineId: string; agentType: AgentConfig['agentType'] } | null {
  const machineId = agentView?.machineId ?? base?.machineId;
  const agentType = base?.agentType ?? agentView?.type;
  return machineId && agentType
    ? { machineId, agentType: agentType as AgentConfig['agentType'] }
    : null;
}

function withRestartDefaults(
  role: string,
  required: { machineId: string; agentType: AgentConfig['agentType'] },
  base: AgentConfig | undefined,
  agentView?: AgentRoleView
): AgentConfig {
  const source: Partial<AgentConfig> = base ?? {
    hostname: '',
    workingDir: '',
    availableHarnesses: [],
    updatedAt: 0,
  };
  return {
    machineId: required.machineId,
    hostname: source.hostname as string,
    alias: source.alias,
    role,
    agentType: required.agentType,
    workingDir: source.workingDir as string,
    model: source.model ?? agentView?.model,
    daemonConnected: source.daemonConnected,
    availableHarnesses: source.availableHarnesses as AgentConfig['availableHarnesses'],
    updatedAt: source.updatedAt as number,
    spawnedAgentPid: source.spawnedAgentPid,
    spawnedAt: source.spawnedAt,
    maxReasoningLevel: source.maxReasoningLevel,
  };
}

function resolveRestartConfigForRole(
  role: string,
  roleConfigMap: Map<string, AgentConfig>,
  machineConfigs: AgentConfig[],
  agentView?: AgentRoleView
): AgentConfig | null {
  const roleLower = role.toLowerCase();
  const runningConfig = machineConfigs.find(
    (c) => c.role.toLowerCase() === roleLower && c.spawnedAgentPid != null
  );
  const base = runningConfig ?? roleConfigMap.get(roleLower);
  const required = resolveRequiredRestartFields(base, agentView);
  return required ? withRestartDefaults(role, required, base, agentView) : null;
}

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
      return buildBulkStartInput(role, config, chatroomId);
    },
    sendCommand
  );
}

async function restartAgentsForRoles(
  agentRoles: string[],
  roleConfigMap: Map<string, AgentConfig>,
  machineConfigs: AgentConfig[],
  agentViewsByRole: Map<string, AgentRoleView>,
  chatroomId: Id<'chatroom_rooms'>,
  sendCommand: SendCommandFn
): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(
    agentRoles.map((role) => {
      const config = resolveRestartConfigForRole(
        role,
        roleConfigMap,
        machineConfigs,
        agentViewsByRole.get(role.toLowerCase())
      );
      if (!config) return Promise.reject(new Error(`Missing agent config for ${role}`));
      if (!config.model) return Promise.reject(new Error(`Missing model for ${role}`));
      return sendCommand({
        machineId: config.machineId,
        type: 'restart-agent',
        payload: buildBulkRestartPayload(role, config, chatroomId),
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

export async function runAgentRestartBatch(
  agentRoles: string[],
  roleConfigMap: Map<string, AgentConfig>,
  machineConfigs: AgentConfig[],
  agentViewsByRole: Map<string, AgentRoleView>,
  chatroomId: Id<'chatroom_rooms'>,
  sendCommand: SendCommandFn,
  onComplete: (failed: string[]) => void
): Promise<void> {
  const results = await restartAgentsForRoles(
    agentRoles,
    roleConfigMap,
    machineConfigs,
    agentViewsByRole,
    chatroomId,
    sendCommand
  );
  onComplete(getFailedAgentRoles(results, agentRoles));
}
