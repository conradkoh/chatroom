// fallow-ignore-file complexity code-duplication
import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent.js';
import type { ApplyAgentConfigResult } from '@workspace/backend/src/domain/usecase/agent/apply-agent-config.js';
import type { AgentModelOptions } from '@workspace/backend/src/domain/usecase/agent/get-agent-model-options.js';

import type { AgentDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';
import { getMachineId, loadMachineConfig } from '../../infrastructure/machine/storage.js';

interface AgentConfig {
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  machineId: string;
  requestedAt?: number;
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
  return (config as (typeof config & { workingDir?: string | undefined }) | null)?.workingDir;
}

async function getConfigs(
  deps: AgentDeps,
  sessionId: string,
  chatroomId: string
): Promise<AgentConfig[]> {
  return (await deps.backend.query(api.agents.listLastSentLaunchRequests, {
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
}

interface TeamHeader {
  teamId: string;
  teamName: string;
  entryPoint: string;
}

interface StatusRow {
  role: string;
  roleKind: 'persistent' | 'ephemeral';
  status: string;
  machineId: string | null;
  workingDir: string | null;
}

/** Runs the server-side apply decision and prints what it did. */
function printApplyResult(result: ApplyAgentConfigResult): void {
  const { role, outcome, running, previous, effective } = result;
  if (outcome === 'unchanged') {
    console.log(
      `No change: ${role} already uses ${effective.agentHarness} / ${effective.model}; not restarted`
    );
  } else if (outcome === 'restarted') {
    console.log(`✅ Restart requested for ${role}`);
  } else {
    console.log(running ? `✅ Saved ${role}` : `✅ Saved ${role} (not running)`);
  }
  // "(was …)" only when something changed; "none" when there was no previous config.
  const was = (old: string | undefined) =>
    outcome === 'unchanged' ? '' : ` (was ${old ?? 'none'})`;
  console.log(`  Harness: ${effective.agentHarness}${was(previous?.agentHarness)}`);
  console.log(`  Model: ${effective.model}${was(previous?.model)}`);
  console.log(`  Machine ID: ${effective.machineId}`);
  console.log(`  Working directory: ${effective.workingDir}`);
  const note =
    outcome === 'restarted'
      ? 'Agent restarted with the new configuration.'
      : outcome === 'saved' && !running
        ? 'The agent is not running; the new configuration is used the next time it starts.'
        : outcome === 'saved'
          ? 'The running agent has no managed configuration and was not restarted.'
          : null;
  if (note) console.log(`  ${note}`);
}

/** Sets a role's harness and model; the backend decides save, restart or no-op. */
export async function setAgentConfig(
  chatroomId: string,
  options: { role: string; harness: string; model: string },
  deps?: AgentDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const result = (await d.backend.mutation(api.agents.applyConfig, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role: options.role,
    agentHarness: options.harness,
    model: options.model,
  })) as ApplyAgentConfigResult;
  printApplyResult(result);
}

/** The newest launch request for a role (case-insensitive), or undefined. */
function newestConfigFor(requests: readonly AgentConfig[], role: string): AgentConfig | undefined {
  const key = role.trim().toLowerCase();
  return requests
    .filter((request) => request.role.trim().toLowerCase() === key)
    .sort((a, b) => (b.requestedAt ?? 0) - (a.requestedAt ?? 0))[0];
}

/** Lists every team role with status, harness, model, machine and working directory. */
export async function listAgents(chatroomId: string, deps?: AgentDeps): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const args = { sessionId, chatroomId: chatroomId as Id<'chatroom_rooms'> };
  const [team, statuses, requests] = (await Promise.all([
    d.backend.query(api.chatrooms.getTeamStructureForChatroom, args),
    d.backend.query(api.agents.listStatus, args),
    d.backend.query(api.agents.listLastSentLaunchRequests, args),
  ])) as [TeamHeader | null, StatusRow[], AgentConfig[]];
  if (!team) throw new Error(`Chatroom has no team structure: ${chatroomId}`);
  console.log(
    `Team: ${team.teamId} (${team.teamName})    Entry point: ${team.entryPoint}    Chatroom: ${chatroomId}`
  );
  for (const row of statuses) {
    const config = newestConfigFor(requests, row.role);
    console.log(`${row.role} (${row.roleKind === 'ephemeral' ? 'ephemeral' : 'permanent'})`);
    console.log(`  Status: ${row.status}`);
    console.log(`  Harness: ${config?.agentHarness ?? '(not configured)'}`);
    console.log(`  Model: ${config?.model ?? '(not configured)'}`);
    console.log(`  Machine ID: ${config?.machineId ?? row.machineId ?? '(unset)'}`);
    console.log(`  Working directory: ${config?.workingDir ?? row.workingDir ?? '(unset)'}`);
  }
}

/** Lists the harnesses and models the role's machine offers, marking the current harness. */
export async function listAgentModels(
  chatroomId: string,
  options: { team: string; role: string; harness?: string | undefined },
  deps?: AgentDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const result = (await d.backend.query(api.agents.getAgentModelOptions, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    teamId: options.team,
    role: options.role,
    ...(options.harness ? { harness: options.harness } : {}), // omit the key when no filter
  })) as AgentModelOptions;
  const current = result.current
    ? `${result.current.agentHarness} / ${result.current.model}`
    : 'not configured';
  console.log(
    `Models for ${result.role} (team ${result.teamId}) on machine ${result.machineId}; current: ${current}`
  );
  for (const option of result.harnesses) {
    console.log(`Harness: ${option.harness}${option.isCurrent ? ' (current)' : ''}`);
    if (option.models.length === 0) console.log('  (no models reported; any model id is accepted)');
    for (const model of option.models) console.log(`  ${model}`);
  }
}

// fallow-ignore-next-line complexity
export async function startAgent(
  chatroomId: string,
  options: {
    role: string;
    harness?: string | undefined;
    model?: string | undefined;
    workingDir?: string | undefined;
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
    },
  });
  console.log(`✅ Start command sent for ${options.role}`);
  console.log(`  Harness: ${harness}`);
  console.log(`  Model: ${model}`);
  console.log(`  Working directory: ${workingDir}`);
  console.log(`  Machine ID: ${machineId}`);
}
