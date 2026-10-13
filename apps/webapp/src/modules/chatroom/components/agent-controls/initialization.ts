/**
 * Pure helpers that decide the first selection for the agent controls. No React here, so each rule
 * can be tested on its own. The order of the sources is the priority: running agent > role config
 * > team binding > workspaces for the machine.
 */

import type { AgentConfig, AgentHarness, MachineInfo } from '../../types/machine';
import type { Workspace } from '../../types/workspace';
import { pickSetupWorkspace } from '../../utils/pickSetupWorkspace';

// ─── Machine ────────────────────────────────────────────────────────

function machineFromRunningAgent(runningAgentConfig: AgentConfig | undefined): string | null {
  return runningAgentConfig ? runningAgentConfig.machineId : null;
}

/** The first connected machine that has a role config. */
function machineFromRoleConfigs(
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[]
): string | null {
  const configMachine = connectedMachines.find((m) =>
    roleConfigs.some((c) => c.machineId === m.machineId)
  );
  return configMachine ? configMachine.machineId : null;
}

/** The team binding, when that machine is connected. */
function machineFromTeamConfig(
  connectedMachines: MachineInfo[],
  teamConfigMachineId?: string | null
): string | null {
  return teamConfigMachineId && connectedMachines.some((m) => m.machineId === teamConfigMachineId)
    ? teamConfigMachineId
    : null;
}

/** Running agent, then role config, then team binding. */
function machineFromSavedSources(
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  runningAgentConfig: AgentConfig | undefined,
  teamConfigMachineId?: string | null
): string | null {
  return (
    machineFromRunningAgent(runningAgentConfig) ??
    machineFromRoleConfigs(connectedMachines, roleConfigs) ??
    machineFromTeamConfig(connectedMachines, teamConfigMachineId)
  );
}

function isUsableWorkspace(ws: Workspace, connectedMachines: MachineInfo[]): boolean {
  return (
    !!ws.machineId &&
    !!ws.workingDir?.trim() &&
    connectedMachines.some((m) => m.machineId === ws.machineId)
  );
}

/** The machine of the most recently registered connected workspace. */
function machineFromWorkspaces(
  connectedMachines: MachineInfo[],
  chatroomWorkspaces?: Workspace[]
): string | null {
  const candidates = (chatroomWorkspaces ?? []).filter((ws) =>
    isUsableWorkspace(ws, connectedMachines)
  );
  const picked = pickSetupWorkspace(
    candidates.map((ws) => ({
      machineId: ws.machineId ?? '',
      workingDir: ws.workingDir,
      registeredAt: ws.registeredAt,
    }))
  );
  return picked?.machineId ?? null;
}

/**
 * Exported for unit tests. Deterministic machine pick. Never falls back to an arbitrary first
 * online machine.
 */
// Exported for initialization.test.ts. Components reach these through resolveInitialSelection.
// fallow-ignore-next-line unused-export
export function deriveInitialMachineId(
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  runningAgentConfig: AgentConfig | undefined,
  teamConfigMachineId?: string | null,
  chatroomWorkspaces?: Workspace[]
): string | null {
  if (connectedMachines.length === 0) return null;
  return (
    machineFromSavedSources(
      connectedMachines,
      roleConfigs,
      runningAgentConfig,
      teamConfigMachineId
    ) ?? machineFromWorkspaces(connectedMachines, chatroomWorkspaces)
  );
}

// ─── Harness ────────────────────────────────────────────────────────

/** The harnesses the machine reports as installed. */
function availableHarnessesOf(connectedMachines: MachineInfo[], machineId: string): AgentHarness[] {
  return connectedMachines.find((m) => m.machineId === machineId)?.availableHarnesses ?? [];
}

/** The harness saved in the persisted launch snapshot, when it is installed on the machine. */
function savedConfigHarness(
  roleConfigs: AgentConfig[],
  machineId: string,
  available: AgentHarness[]
): AgentHarness | null {
  const config = roleConfigs.find((c) => c.machineId === machineId);
  return config && available.includes(config.agentType) ? config.agentType : null;
}

/** The team config's harness, when it is installed on the machine. */
function teamConfigHarnessOn(
  teamConfigHarness: AgentHarness | undefined,
  available: AgentHarness[]
): AgentHarness | null {
  return teamConfigHarness && available.includes(teamConfigHarness) ? teamConfigHarness : null;
}

/** The only harness the machine reports, when there is exactly one. */
function onlyAvailableHarness(available: AgentHarness[]): AgentHarness | null {
  return available.length === 1 ? (available[0] ?? null) : null;
}

/** Saved config harness > team config harness > the only installed harness. */
function deriveInitialHarness(
  machineId: string | null,
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  teamConfigHarness?: AgentHarness
): AgentHarness | null {
  if (!machineId) return null;
  const available = availableHarnessesOf(connectedMachines, machineId);
  return (
    savedConfigHarness(roleConfigs, machineId, available) ??
    teamConfigHarnessOn(teamConfigHarness, available) ??
    onlyAvailableHarness(available)
  );
}

/**
 * True when deriveInitialHarness takes its harness from the persisted snapshot or the team config,
 * rather than from the fallbacks. The favourite default must never override those choices.
 */
function isHarnessSeededFromConfig(
  machineId: string | null,
  connectedMachines: MachineInfo[],
  roleConfigs: AgentConfig[],
  teamConfigHarness?: AgentHarness
): boolean {
  if (!machineId) return false;
  const available = availableHarnessesOf(connectedMachines, machineId);
  return (
    savedConfigHarness(roleConfigs, machineId, available) !== null ||
    teamConfigHarnessOn(teamConfigHarness, available) !== null
  );
}

// ─── Working directory ──────────────────────────────────────────────

function workspaceWorkingDir(
  chatroomWorkspaces: Workspace[] | undefined,
  machineId: string
): string | null {
  return chatroomWorkspaces?.find((w) => w.machineId === machineId)?.workingDir || null;
}

/** The machine's working dir: its role config first, then its registered workspace. */
function machineWorkingDir(
  machineId: string | null,
  roleConfigs: AgentConfig[],
  chatroomWorkspaces?: Workspace[]
): string | null {
  if (!machineId) return null;
  const configDir = roleConfigs.find((c) => c.machineId === machineId)?.workingDir;
  return configDir || workspaceWorkingDir(chatroomWorkspaces, machineId);
}

/** The working dir of the most recently updated role config. */
function latestConfigWorkingDir(roleConfigs: AgentConfig[]): string | null {
  if (roleConfigs.length === 0) return null;
  const latest = roleConfigs.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return latest.workingDir || null;
}

export function deriveInitialWorkingDir(
  machineId: string | null,
  roleConfigs: AgentConfig[],
  chatroomWorkspaces?: Workspace[]
): string {
  return (
    machineWorkingDir(machineId, roleConfigs, chatroomWorkspaces) ??
    latestConfigWorkingDir(roleConfigs) ??
    ''
  );
}

// ─── Initialization ─────────────────────────────────────────────────

function configWorkingDir(roleConfigs: AgentConfig[], machineId: string): string | undefined {
  return roleConfigs.find((c) => c.machineId === machineId)?.workingDir;
}

/** Wait for workspaces when they may supply the machine or its working directory. */
// Exported for initialization.test.ts. Components reach these through resolveInitialSelection.
// fallow-ignore-next-line unused-export
export function shouldDeferInitUntilWorkspacesLoad(
  machineId: string | null,
  roleConfigs: AgentConfig[],
  preferredWorkspace?: Workspace
): boolean {
  if (!machineId) return true;
  return !configWorkingDir(roleConfigs, machineId) && !preferredWorkspace?.workingDir;
}

export interface InitializationInputs {
  connectedMachines: MachineInfo[];
  roleConfigs: AgentConfig[];
  runningAgentConfig: AgentConfig | undefined;
  teamConfigMachineId?: string | null;
  teamConfigHarness?: AgentHarness;
  initializationWorkspaces?: Workspace[];
  preferredWorkspace?: Workspace;
  chatroomWorkspacesLoading?: boolean;
  lockedMachineId?: string;
  lockedWorkingDir?: string;
}

export interface InitialSelection {
  machineId: string | null;
  harness: AgentHarness | null;
  workingDir: string;
  /** True when the persisted snapshot or team config chose the harness. */
  seededFromConfig: boolean;
}

/** Initialization runs once, when machines are known and the selected config has loaded. */
export function isReadyToInitialize(args: {
  isInitialized: boolean;
  connectedCount: number;
  workspaceId?: string;
  configurationLoading: boolean;
}): boolean {
  if (args.isInitialized || args.connectedCount === 0) return false;
  return !(args.workspaceId !== undefined && args.configurationLoading);
}

function pickInitialMachine(input: InitializationInputs): string | null {
  return (
    input.lockedMachineId ??
    deriveInitialMachineId(
      input.connectedMachines,
      input.roleConfigs,
      input.runningAgentConfig,
      input.teamConfigMachineId,
      input.initializationWorkspaces
    )
  );
}

/** True while workspaces are still loading and may still supply the machine or its working dir. */
function mustWaitForWorkspaces(input: InitializationInputs, machineId: string | null): boolean {
  return (
    !!input.chatroomWorkspacesLoading &&
    shouldDeferInitUntilWorkspacesLoad(machineId, input.roleConfigs, input.preferredWorkspace)
  );
}

/** The selection the one-time initialization applies, or null while it must wait for workspaces. */
export function resolveInitialSelection(input: InitializationInputs): InitialSelection | null {
  const machineId = pickInitialMachine(input);
  if (mustWaitForWorkspaces(input, machineId)) return null;
  return {
    machineId,
    harness: deriveInitialHarness(
      machineId,
      input.connectedMachines,
      input.roleConfigs,
      input.teamConfigHarness
    ),
    workingDir:
      input.lockedWorkingDir ??
      deriveInitialWorkingDir(machineId, input.roleConfigs, input.initializationWorkspaces),
    seededFromConfig: isHarnessSeededFromConfig(
      machineId,
      input.connectedMachines,
      input.roleConfigs,
      input.teamConfigHarness
    ),
  };
}
