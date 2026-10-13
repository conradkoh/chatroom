/**
 * Pure rules for the Remote tab: which values it shows, what its labels say, and when its controls
 * are disabled. Each function is small enough to read in one go.
 */

import type { MachineConnectivity } from '../../../../hooks/useDaemonConnectivity';
import { computeRecommendedMachineConfigs } from '../../features/machine-config/lib/computeRecommendedMachineConfigs';
import type { MachineConfigEntry } from '../../features/machine-config/types/machineConfig';
import {
  formatHarnessLabel,
  getMachineDisplayName,
  getModelDisplayLabel,
  type AgentConfig,
  type AgentHarness,
  type HarnessVersionInfo,
  type MachineInfo,
} from '../../types/machine';

// ─── Display values ─────────────────────────────────────────────────

export interface RemoteFormValues {
  machineId: string | null;
  harness: AgentHarness | null;
  model: string | null;
  workingDir: string;
}

/** Use the running agent's value while one runs. Otherwise use the form state. */
function pick<T>(running: T | null | undefined, form: T): T {
  return running ?? form;
}

/**
 * What the Remote tab shows. While an agent runs, the display comes from the running config. The
 * form state is preserved and used again once the agent stops.
 */
export function deriveDisplayValues(
  running: AgentConfig | undefined,
  form: RemoteFormValues
): RemoteFormValues {
  if (!running) return form;
  return {
    machineId: pick(running.machineId, form.machineId),
    harness: pick(running.agentType, form.harness),
    model: pick(running.model, form.model),
    workingDir: pick(running.workingDir, form.workingDir),
  };
}

/** The machine's display name, or its id when it is not in the connected list, or a placeholder. */
export function machineLabelFor(
  connectedMachines: MachineInfo[],
  machineId: string | null
): string {
  if (!machineId) return 'Machine...';
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  return machine ? getMachineDisplayName(machine) : machineId;
}

export function harnessLabelFor(
  harness: AgentHarness | null,
  versions: Partial<Record<AgentHarness, HarnessVersionInfo>>
): string {
  return harness ? formatHarnessLabel(harness, versions[harness]) : 'Harness...';
}

// ─── Empty and disabled states ──────────────────────────────────────

/** True when loading has finished and no machine is connected. */
export function deriveHasNoMachines(isLoadingMachines: boolean, connectedCount: number): boolean {
  return !isLoadingMachines && connectedCount === 0;
}

/** Model controls are unavailable without a machine, a harness, and at least one model. */
export function deriveModelUnavailable(
  machineId: string | null,
  harness: AgentHarness | null,
  hasModels: boolean
): boolean {
  return !machineId || !harness || !hasModels;
}

export function deriveHarnessDisabled(
  isBusy: boolean,
  machineId: string | null,
  harnessCount: number
): boolean {
  return isBusy || !machineId || harnessCount === 0;
}

/** The warning tone applies to a model that the machine filter hides, when models are available. */
export function deriveModelWarning(
  modelUnavailable: boolean,
  isSelectedModelHidden: boolean
): boolean {
  return !modelUnavailable && isSelectedModelHidden;
}

/** Label of the read-only model while an agent runs. */
export function runningModelText(modelUnavailable: boolean, displayModel: string | null): string {
  if (modelUnavailable) return 'No models available';
  return displayModel ? getModelDisplayLabel(displayModel) : 'Model...';
}

/** Value of the model picker. Empty while the model is unavailable. */
export function modelPickerValue(modelUnavailable: boolean, displayModel: string | null): string {
  return modelUnavailable ? '' : (displayModel ?? '');
}

// ─── Visibility ─────────────────────────────────────────────────────

/** The favourite button needs a machine and a current config. */
export function showFavoriteToggle(
  machineId: string | null,
  entry: MachineConfigEntry | null
): boolean {
  return !!machineId && !!entry;
}

/** The model filter button needs a machine and a harness. */
export function showModelFilter(machineId: string | null, harness: AgentHarness | null): boolean {
  return !!machineId && !!harness;
}

/** A row that is not a setup-wizard row, with no agent running and no machine selected yet. */
function isIdleAndUnselected(args: {
  setupMode: boolean;
  isAgentRunning: boolean;
  selectedMachineId: string | null;
}): boolean {
  return !args.setupMode && !args.isAgentRunning && !args.selectedMachineId;
}

function hasMachinesToPick(args: { connectedCount: number; isLoadingMachines: boolean }): boolean {
  return args.connectedCount > 0 && !args.isLoadingMachines;
}

/** Asks the user to choose a machine, when there are machines but none is selected. */
export function shouldShowSelectHint(args: {
  setupMode: boolean;
  isAgentRunning: boolean;
  selectedMachineId: string | null;
  connectedCount: number;
  isLoadingMachines: boolean;
}): boolean {
  return isIdleAndUnselected(args) && hasMachinesToPick(args);
}

// ─── Favourite toggle ───────────────────────────────────────────────

export function favoriteToggleLabel(isFavorite: boolean): string {
  return isFavorite ? 'Remove current config from favorites' : 'Add current config to favorites';
}

export function currentIsFavorite(
  entry: MachineConfigEntry | null,
  isFavorite: (entry: MachineConfigEntry) => boolean
): boolean {
  return entry ? isFavorite(entry) : false;
}

// ─── Recommendations ────────────────────────────────────────────────

/** Favourites that the machine can still run, in their stored order. */
function favoriteCandidates(
  favorites: MachineConfigEntry[],
  availableHarnesses: AgentHarness[]
): MachineConfigEntry[] {
  const candidates: MachineConfigEntry[] = [];
  for (const fav of favorites) {
    if (availableHarnesses.includes(fav.agentHarness)) candidates.push(fav);
  }
  return candidates;
}

/** A usage key is `harness|model`. It is a candidate only while its harness is still installed. */
function isUsableUsageKey(
  harness: string | undefined,
  model: string | undefined,
  availableHarnesses: AgentHarness[]
): boolean {
  return !!harness && !!model && availableHarnesses.includes(harness as AgentHarness);
}

function usageCandidates(
  usage: Map<string, number[]>,
  availableHarnesses: AgentHarness[]
): MachineConfigEntry[] {
  const candidates: MachineConfigEntry[] = [];
  for (const key of usage.keys()) {
    const [harness, model] = key.split('|');
    // The guard above proves both parts are set, so the casts are safe.
    if (isUsableUsageKey(harness, model, availableHarnesses)) {
      candidates.push({ agentHarness: harness as AgentHarness, model: model as string });
    }
  }
  return candidates;
}

/** The recommended configs for the scope: favourites, the current config, and recent usage. */
export function deriveRecommendedConfigs(args: {
  scopeKey: string | undefined;
  usage: Map<string, number[]>;
  favorites: MachineConfigEntry[];
  availableHarnesses: AgentHarness[];
  displayHarness: AgentHarness | null;
  displayModel: string | null;
}): MachineConfigEntry[] {
  if (!args.scopeKey) return [];
  const candidates = favoriteCandidates(args.favorites, args.availableHarnesses);
  if (args.displayHarness && args.displayModel) {
    candidates.push({ agentHarness: args.displayHarness, model: args.displayModel });
  }
  candidates.push(...usageCandidates(args.usage, args.availableHarnesses));
  return computeRecommendedMachineConfigs(args.usage, args.favorites, candidates);
}

/** Whether the machine's daemon reports itself connected. */
export function isDaemonConnected(
  connectivity: Map<string, MachineConnectivity> | undefined,
  machineId: string
): boolean {
  return connectivity?.get(machineId)?.connected === true;
}
