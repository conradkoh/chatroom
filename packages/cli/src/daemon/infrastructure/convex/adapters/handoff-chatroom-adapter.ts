import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import type { OrchestrationHost } from '../../../domain/value-objects/orchestration-host.js';

export type HandoffChatroomContext = {
  teamRoles: string[];
  supportsNativeIntegration: boolean;
  hasActiveEnhancerWork: boolean;
  enhancerConfig?: {
    machineId: string;
    agentHarness: string;
    model: string;
    enabled: boolean;
  };
};

export type HandoffChatroomAdapterDeps = {
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  sessionId: string;
};

type ChatroomDoc = {
  teamRoles?: string[];
  orchestrationMachineId?: string;
  orchestrationWorkingDir?: string;
};

type EnhancerConfigDoc = {
  enabled: boolean;
  agentHarness: string;
  model: string;
  machineId: string;
} | null;

type AgentStartConfig = {
  agentHarness?: string;
} | null;

// fallow-ignore-next-line complexity
export async function fetchHandoffChatroomContext(
  deps: HandoffChatroomAdapterDeps,
  chatroomId: string
): Promise<HandoffChatroomContext> {
  const chatroom = (await deps.query(api.chatrooms.get, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as ChatroomDoc | null;

  if (!chatroom) {
    throw new Error(`Chatroom not found: ${chatroomId}`);
  }

  const teamRoles = (chatroom.teamRoles ?? []).map((role) => role.toLowerCase());

  const activeEnhancerRows = (await deps.query(api.chatrooms.listActiveEnhancerWork, {
    sessionId: deps.sessionId,
  })) as { chatroomId: string }[];

  const hasActiveEnhancerWork = activeEnhancerRows.some((row) => row.chatroomId === chatroomId);

  const enhancerConfig = (await deps.query(api.web.enhancer.index.getConfig, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as EnhancerConfigDoc;

  const senderHarness = await getAgentHarnessForRole(deps, chatroomId, 'planner');
  const supportsNativeIntegration =
    senderHarness !== undefined &&
    getHarnessCapabilities(senderHarness as Parameters<typeof getHarnessCapabilities>[0])
      .supportsNativeIntegration;

  return {
    teamRoles,
    supportsNativeIntegration,
    hasActiveEnhancerWork,
    enhancerConfig: enhancerConfig
      ? {
          machineId: enhancerConfig.machineId,
          agentHarness: enhancerConfig.agentHarness,
          model: enhancerConfig.model,
          enabled: enhancerConfig.enabled,
        }
      : undefined,
  };
}

export async function getAgentHarnessForRole(
  deps: HandoffChatroomAdapterDeps,
  chatroomId: string,
  role: string
): Promise<string | undefined> {
  const config = (await deps.query(api.machines.getAgentStartConfig, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
  })) as AgentStartConfig;

  return config?.agentHarness;
}

/** P8: resolve the chatroom's orchestration host, or null when unbound. */
export async function fetchChatroomOrchestrationHost(
  deps: HandoffChatroomAdapterDeps,
  chatroomId: string
): Promise<OrchestrationHost | null> {
  const chatroom = (await deps.query(api.chatrooms.get, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as ChatroomDoc | null;

  if (!chatroom?.orchestrationMachineId || !chatroom.orchestrationWorkingDir) return null;
  return {
    machineId: chatroom.orchestrationMachineId,
    workingDir: chatroom.orchestrationWorkingDir,
  };
}
