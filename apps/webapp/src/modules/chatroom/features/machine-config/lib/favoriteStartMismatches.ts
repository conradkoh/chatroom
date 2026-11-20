// Consumed by the start-all favourites prompt in the next slice.
// fallow-ignore-file unused-file
import type { AgentHarness } from '../../../types/machine';
import type { MachineConfigEntry } from '../types/machineConfig';

export interface StartCheckWorkspace {
  id: string;
  machineId: string;
  workingDir: string;
  label: string;
}

export interface StartCheckLaunchRequest {
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
}

export interface FavoriteMismatch {
  workspaceId: string;
  workspaceLabel: string;
  machineId: string;
  workingDir: string;
  role: string;
  current: { agentHarness: AgentHarness; model: string };
  favorite: MachineConfigEntry;
}

export interface FindFavoriteMismatchesInput {
  /** Non-user team roles, in team order. The caller removes `user`. */
  roles: readonly string[];
  /** Active workspaces only, in display order. */
  workspaces: readonly StartCheckWorkspace[];
  /** Last-sent launch requests per workspace id. */
  requestsByWorkspace: ReadonlyMap<string, readonly StartCheckLaunchRequest[]>;
  /** Key: `favoritesKey(machineId, role)`. Value: favourites in rank order (index 0 is top). */
  favoritesByMachineRole: ReadonlyMap<string, readonly MachineConfigEntry[]>;
  /** Harnesses installed per machine id. A machine missing from the map has none. */
  availableHarnessesByMachine: ReadonlyMap<string, readonly AgentHarness[]>;
  /** Lower-case role names currently running or starting. `undefined` = status unknown: skip nothing. */
  runningRoles: ReadonlySet<string> | undefined;
}

/** Key for `favoritesByMachineRole`. Roles are lower-cased, matching `buildMachineFavoriteScopeKey`. */
export function favoritesKey(machineId: string, role: string): string {
  return `${machineId}|${role.toLowerCase()}`;
}

/** Only a complete saved config (harness, model, working dir) is meaningful for the comparison. */
function isCompleteStartConfig(request: StartCheckLaunchRequest): boolean {
  return (
    Boolean(request.agentHarness) && request.model.trim() !== '' && request.workingDir.trim() !== ''
  );
}

/** True when starting the request would already use the favourite's harness and model. */
function matchesFavorite(request: StartCheckLaunchRequest, favorite: MachineConfigEntry): boolean {
  return request.agentHarness === favorite.agentHarness && request.model === favorite.model;
}

function toMismatch(
  workspace: StartCheckWorkspace,
  role: string,
  request: StartCheckLaunchRequest,
  favorite: MachineConfigEntry
): FavoriteMismatch {
  return {
    workspaceId: workspace.id,
    workspaceLabel: workspace.label,
    machineId: workspace.machineId,
    workingDir: workspace.workingDir,
    role,
    current: { agentHarness: request.agentHarness, model: request.model },
    favorite,
  };
}

/** `undefined` status means unknown: no role is skipped. */
function isRunningRole(role: string, runningRoles: ReadonlySet<string> | undefined): boolean {
  return runningRoles?.has(role.toLowerCase()) ?? false;
}

function topFavorite(
  input: FindFavoriteMismatchesInput,
  workspace: StartCheckWorkspace,
  role: string
): MachineConfigEntry | undefined {
  return input.favoritesByMachineRole.get(favoritesKey(workspace.machineId, role))?.[0];
}

function isFavoriteInstalled(
  input: FindFavoriteMismatchesInput,
  workspace: StartCheckWorkspace,
  favorite: MachineConfigEntry
): boolean {
  const installed = input.availableHarnessesByMachine.get(workspace.machineId) ?? [];
  return installed.includes(favorite.agentHarness);
}

/** Last-sent launch request for this role in the workspace, complete or not. */
function launchRequest(
  input: FindFavoriteMismatchesInput,
  workspace: StartCheckWorkspace,
  role: string
): StartCheckLaunchRequest | undefined {
  const requests = input.requestsByWorkspace.get(workspace.id) ?? [];
  return requests.find((entry) => entry.role === role);
}

/** Saved launch request to compare, or `undefined` when the role is skipped or incomplete. */
function comparableRequest(
  input: FindFavoriteMismatchesInput,
  workspace: StartCheckWorkspace,
  role: string
): StartCheckLaunchRequest | undefined {
  if (isRunningRole(role, input.runningRoles)) return undefined;
  const request = launchRequest(input, workspace, role);
  return request && isCompleteStartConfig(request) ? request : undefined;
}

/** Top favourite for this workspace/role when its harness is installed, else `undefined`. */
function installedTopFavorite(
  input: FindFavoriteMismatchesInput,
  workspace: StartCheckWorkspace,
  role: string
): MachineConfigEntry | undefined {
  const favorite = topFavorite(input, workspace, role);
  return favorite && isFavoriteInstalled(input, workspace, favorite) ? favorite : undefined;
}

function findMismatch(
  workspace: StartCheckWorkspace,
  role: string,
  input: FindFavoriteMismatchesInput
): FavoriteMismatch | null {
  const request = comparableRequest(input, workspace, role);
  const favorite = installedTopFavorite(input, workspace, role);
  if (!request || !favorite) return null;
  if (matchesFavorite(request, favorite)) return null;
  return toMismatch(workspace, role, request, favorite);
}

/**
 * Every (workspace, role) pair that a start-all would start on a configuration other than the
 * role's top favourite. Output order: workspace order, then role order.
 */
export function findFavoriteMismatches(input: FindFavoriteMismatchesInput): FavoriteMismatch[] {
  return input.workspaces.flatMap((workspace) =>
    input.roles.flatMap((role) => {
      const mismatch = findMismatch(workspace, role, input);
      return mismatch ? [mismatch] : [];
    })
  );
}
