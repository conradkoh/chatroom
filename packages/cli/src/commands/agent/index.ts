import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent.js';

import type { AgentDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import type { MaxReasoningLevel } from '../../daemon/domain/entities/harness-shared-types.js';
import { getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';
import { getMachineId, loadMachineConfig } from '../../infrastructure/machine/storage.js';

interface AgentConfig {
  role: string;
  agentHarness?: string;
  model?: string;
  workingDir?: string;
  machineId?: string;
  desiredState?: string;
  maxReasoningLevel?: MaxReasoningLevel;
}

async function createDefaultDeps(): Promise<AgentDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: { getSessionId },
    machine: { getMachineId, loadMachineConfig },
  };
}

async function requireSession(deps: AgentDeps): Promise<string> {
  const sessionId = await deps.session.getSessionId();
  if (!sessionId) throw new Error('Not authenticated. Please run: chatroom auth login');
  return sessionId;
}

async function requireMachineId(deps: AgentDeps): Promise<string> {
  const machineId = await deps.machine.getMachineId();
  if (!machineId) throw new Error('Run machine daemon start first');
  return machineId;
}

function configuredWorkingDir(
  config: Awaited<ReturnType<AgentDeps['machine']['loadMachineConfig']>>
): string | undefined {
  return (config as (typeof config & { workingDir?: string }) | null)?.workingDir;
}

async function getConfigs(
  deps: AgentDeps,
  sessionId: string,
  chatroomId: string
): Promise<AgentConfig[]> {
  return (await deps.backend.query(api.machines.getTeamAgentConfigs, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as AgentConfig[];
}

// fallow-ignore-next-line complexity
export async function getAgentConfig(
  chatroomId: string,
  role: string,
  deps?: AgentDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const config = (await getConfigs(d, sessionId, chatroomId)).find(
    (candidate) => candidate.role.toLowerCase() === role.toLowerCase()
  );
  if (!config) throw new Error(`No agent config found for role "${role}"`);
  console.log(`Agent config: ${role}`);
  console.log(`  Harness: ${config.agentHarness ?? '(unset)'}`);
  console.log(`  Model: ${config.model ?? '(unset)'}`);
  console.log(`  Working directory: ${config.workingDir ?? '(unset)'}`);
  console.log(`  Machine ID: ${config.machineId ?? '(unset)'}`);
  console.log(`  Desired state: ${config.desiredState ?? '(unset)'}`);
  console.log(`  Max reasoning level: ${config.maxReasoningLevel ?? '(unset)'}`);
}

// fallow-ignore-next-line complexity
export async function setAgentConfig(
  chatroomId: string,
  options: {
    role: string;
    harness: string;
    model: string;
    workingDir?: string;
    maxReasoningLevel?: MaxReasoningLevel;
  },
  deps?: AgentDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const machineId = await requireMachineId(d);
  const machineConfig = await d.machine.loadMachineConfig();
  const workingDir = options.workingDir ?? configuredWorkingDir(machineConfig) ?? process.cwd();
  await d.backend.mutation(api.machines.saveTeamAgentConfig, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role: options.role,
    type: 'remote',
    machineId,
    agentHarness: options.harness as AgentHarness,
    model: options.model,
    workingDir,
    ...(options.maxReasoningLevel !== undefined
      ? { maxReasoningLevel: options.maxReasoningLevel }
      : {}),
  });
  console.log(`✅ Agent config saved for ${options.role}`);
  console.log(`  Harness: ${options.harness}`);
  console.log(`  Model: ${options.model}`);
  console.log(`  Working directory: ${workingDir}`);
  console.log(`  Machine ID: ${machineId}`);
  if (options.maxReasoningLevel) {
    console.log(`  Max reasoning level: ${options.maxReasoningLevel}`);
  }
}

// fallow-ignore-next-line complexity
export async function startAgent(
  chatroomId: string,
  options: {
    role: string;
    harness?: string;
    model?: string;
    workingDir?: string;
    maxReasoningLevel?: MaxReasoningLevel;
  },
  deps?: AgentDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const machineId = await requireMachineId(d);
  const configs = await getConfigs(d, sessionId, chatroomId);
  const existing = configs.find(
    (candidate) => candidate.role.toLowerCase() === options.role.toLowerCase()
  );
  const machineConfig = await d.machine.loadMachineConfig();
  const harness = options.harness ?? existing?.agentHarness;
  const model = options.model ?? existing?.model;
  const workingDir =
    options.workingDir ??
    existing?.workingDir ??
    configuredWorkingDir(machineConfig) ??
    process.cwd();
  const maxReasoningLevel = options.maxReasoningLevel ?? existing?.maxReasoningLevel;
  if (!harness || !model) {
    throw new Error('Harness and model are required; provide flags or configure the agent first');
  }
  await d.backend.mutation(api.machines.sendCommand, {
    sessionId,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role: options.role,
      agentHarness: harness as AgentHarness,
      model,
      workingDir,
      ...(maxReasoningLevel !== undefined ? { maxReasoningLevel } : {}),
    },
  });
  console.log(`✅ Start command sent for ${options.role}`);
  console.log(`  Harness: ${harness}`);
  console.log(`  Model: ${model}`);
  console.log(`  Working directory: ${workingDir}`);
  console.log(`  Machine ID: ${machineId}`);
  if (maxReasoningLevel) {
    console.log(`  Max reasoning level: ${maxReasoningLevel}`);
  }
}
