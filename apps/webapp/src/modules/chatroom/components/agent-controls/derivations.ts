/**
 * Pure derivations for the agent controls: status flags, labels, and the payloads of the start and
 * save actions. Each function is small enough to read in one go.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { pickFavoriteModelForHarness } from '../../features/machine-config/lib/pickFavoriteDefault';
import type { MachineConfigEntry } from '../../features/machine-config/types/machineConfig';
import {
  getMachineDisplayName,
  type AgentConfig,
  type AgentHarness,
  type HarnessVersionInfo,
  type MachineInfo,
} from '../../types/machine';
import { selectModel } from '../../utils/modelSelection';

// ─── Running agent and machine facts ────────────────────────────────

function isConnected(connectedMachines: MachineInfo[], machineId: string): boolean {
  return connectedMachines.some((m) => m.machineId === machineId);
}

/** A running agent on a connected machine: its PID is known, or the runtime reports it running. */
export function deriveRunningAgentConfig(
  roleConfigs: AgentConfig[],
  connectedMachines: MachineInfo[],
  runtimeIsRunning: boolean
): AgentConfig | undefined {
  const pidBackedConfig = roleConfigs.find(
    (c) => c.spawnedAgentPid && isConnected(connectedMachines, c.machineId)
  );
  if (pidBackedConfig) return pidBackedConfig;
  if (!runtimeIsRunning) return undefined;
  return roleConfigs.find((c) => isConnected(connectedMachines, c.machineId));
}

export function deriveHarnessesOf(
  connectedMachines: MachineInfo[],
  selectedMachineId: string | null
): AgentHarness[] {
  if (!selectedMachineId) return [];
  const machine = connectedMachines.find((m) => m.machineId === selectedMachineId);
  return machine?.availableHarnesses || [];
}

export function deriveHarnessVersionsOf(
  connectedMachines: MachineInfo[],
  selectedMachineId: string | null
): Partial<Record<AgentHarness, HarnessVersionInfo>> {
  if (!selectedMachineId) return {} as Partial<Record<AgentHarness, HarnessVersionInfo>>;
  const machine = connectedMachines.find((m) => m.machineId === selectedMachineId);
  return machine?.harnessVersions || {};
}

/** Labels for the rehome confirm: the previous and next machine names. */
export function deriveRehomeLabels(
  teamConfigMachineId: string | null | undefined,
  selectedMachineId: string | null,
  connectedMachines: MachineInfo[]
): { previous: string; next: string } | null {
  if (!teamConfigMachineId || !selectedMachineId) return null;
  return {
    previous: displayNameOr(connectedMachines, teamConfigMachineId),
    next: displayNameOr(connectedMachines, selectedMachineId),
  };
}

function displayNameOr(connectedMachines: MachineInfo[], machineId: string): string {
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  return machine ? getMachineDisplayName(machine) : machineId;
}

/** The favourite default is blocked by an explicit choice, a running agent, or a saved snapshot. */
export function favoriteDefaultBlocked(
  harnessTouched: boolean,
  runningAgentConfig: AgentConfig | undefined,
  hasSnapshot: boolean
): boolean {
  return harnessTouched || !!runningAgentConfig || hasSnapshot;
}

// ─── Model ──────────────────────────────────────────────────────────

/** Model selection waits for the machine, harness, models, and filter to be known. */
export function deriveModelSelectionReady(args: {
  selectedMachineId: string | null;
  selectedHarness: AgentHarness | null;
  machineModelsLoading: boolean;
  machineModelFilterLoading: boolean;
}): boolean {
  return (
    !!args.selectedMachineId &&
    !!args.selectedHarness &&
    !args.machineModelsLoading &&
    !args.machineModelFilterLoading
  );
}

function userChoiceFor(
  harness: AgentHarness | null,
  userModelByHarness: Partial<Record<AgentHarness, string>>
): string | undefined {
  return harness ? userModelByHarness[harness] : undefined;
}

function preferenceModelFor(
  favorites: readonly MachineConfigEntry[],
  harness: AgentHarness | null,
  visibleModels: readonly string[]
): string | undefined {
  return harness ? pickFavoriteModelForHarness(favorites, harness, visibleModels) : undefined;
}

/**
 * The model the selection shows. Priority, from highest: the user's choice for this harness, the
 * machine config, the team config, then the favourite preference.
 */
export function deriveSelectedModel(args: {
  modelSelectionReady: boolean;
  roleConfigs: AgentConfig[];
  selectedMachineId: string | null;
  selectedHarness: AgentHarness | null;
  availableModelsForHarness: string[];
  visibleModels: string[];
  userModelByHarness: Partial<Record<AgentHarness, string>>;
  teamConfigModel?: string;
  defaultFavorites: readonly MachineConfigEntry[];
}): string | null {
  if (!args.modelSelectionReady) return null;
  // Machine config model — only if it's saved under the same harness type
  const config = args.roleConfigs.find(
    (c) => c.machineId === args.selectedMachineId && c.agentType === args.selectedHarness && c.model
  );
  return selectModel({
    selectedHarness: args.selectedHarness,
    availableModels: args.availableModelsForHarness,
    visibleModels: args.visibleModels,
    userChoice: userChoiceFor(args.selectedHarness, args.userModelByHarness),
    machineConfigModel: config?.model ?? undefined,
    teamConfigModel: args.teamConfigModel,
    preferenceModel: preferenceModelFor(
      args.defaultFavorites,
      args.selectedHarness,
      args.visibleModels
    ),
  });
}

// ─── Status flags ───────────────────────────────────────────────────

export interface AgentStatusInput {
  selectedMachineId: string | null;
  selectedHarness: AgentHarness | null;
  selectedModel: string | null;
  hasModels: boolean;
  workingDir: string;
  workspaceId?: string;
  isStarting: boolean;
  isSaving: boolean;
  isStopSubmitting: boolean;
  isAgentRunning: boolean;
  success: string | null;
}

/** Start needs a machine, a harness, a model when the harness has models, and a working dir. */
function isStartReady(s: AgentStatusInput): boolean {
  return !!s.selectedMachineId && !!s.selectedHarness && (!s.hasModels || !!s.selectedModel);
}

function isStartAllowed(s: AgentStatusInput): boolean {
  return !!s.workingDir.trim() && !s.isStarting && !s.isAgentRunning && !s.success;
}

function deriveCanStart(s: AgentStatusInput): boolean {
  return isStartReady(s) && isStartAllowed(s);
}

/** Save needs the workspace and machine, a harness, and a model. */
function isSaveTargetSet(s: AgentStatusInput): boolean {
  return !!s.workspaceId && !!s.selectedMachineId && !!s.selectedHarness && !!s.selectedModel;
}

function isIdleForSave(s: AgentStatusInput): boolean {
  return !s.isSaving && !s.isStarting && !s.isStopSubmitting;
}

function isSaveAllowed(s: AgentStatusInput): boolean {
  return !!s.workingDir.trim() && isIdleForSave(s) && !s.isAgentRunning;
}

function deriveCanSave(s: AgentStatusInput): boolean {
  return isSaveTargetSet(s) && isSaveAllowed(s);
}

function deriveIsBusy(isStarting: boolean, isSaving: boolean, isStopping: boolean): boolean {
  return isStarting || isSaving || isStopping;
}

function canStopNow(s: AgentStatusInput): boolean {
  return s.isAgentRunning && !s.isStopSubmitting && !s.success;
}

function canRestartNow(s: AgentStatusInput): boolean {
  return canStopNow(s) && !s.isStarting;
}

/** The flags the controls and their buttons read, derived from the action state. */
export function deriveAgentStatus(s: AgentStatusInput) {
  return {
    isStopping: s.isStopSubmitting,
    isBusy: deriveIsBusy(s.isStarting, s.isSaving, s.isStopSubmitting),
    canStart: deriveCanStart(s),
    canSave: deriveCanSave(s),
    canStop: canStopNow(s),
    canRestart: canRestartNow(s),
  };
}

// ─── Action payloads ────────────────────────────────────────────────

/** The workspace id field for a command payload, present only when there is a workspace. */
export function workspaceField(workspaceId: string | undefined): {
  workspaceId?: Id<'chatroom_workspaces'>;
} {
  return workspaceId ? { workspaceId: workspaceId as Id<'chatroom_workspaces'> } : {};
}

/** Restart uses the running agent's model, or the selected one when it has none. */
export function restartModelFor(
  displayAgentConfig: AgentConfig,
  selectedModel: string | null
): string | null | undefined {
  return displayAgentConfig.model ?? selectedModel;
}

/** A rehome is needed when a team binding exists and the selected machine is different. */
export function isRehomeNeeded(
  teamConfigMachineId: string | null | undefined,
  selectedMachineId: string
): boolean {
  return teamConfigMachineId != null && selectedMachineId !== teamConfigMachineId;
}

/** The save target when the scope (workspace and machine) is set and saving is allowed. */
export function saveScopeOf(
  canSave: boolean,
  workspaceId: string | undefined,
  machineId: string | null
): { workspaceId: string; machineId: string } | null {
  if (!canSave || !workspaceId || !machineId) return null;
  return { workspaceId, machineId };
}

/** The harness and model to save, when both are chosen. */
export function saveChoiceOf(
  harness: AgentHarness | null,
  model: string | null
): { harness: AgentHarness; model: string } | null {
  if (!harness || !model) return null;
  return { harness, model };
}

/** The payload of a start command. The model and working dir are dropped when empty. */
export function startCommandOf(args: {
  machineId: string;
  chatroomId: string;
  workspaceId: string | undefined;
  role: string;
  model: string | null;
  agentHarness: AgentHarness;
  workingDir: string;
  allowNewMachine?: boolean;
}) {
  return {
    machineId: args.machineId,
    chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
    ...workspaceField(args.workspaceId),
    role: args.role,
    model: args.model || undefined,
    agentHarness: args.agentHarness,
    workingDir: args.workingDir.trim() || undefined,
    allowNewMachine: args.allowNewMachine,
  };
}
