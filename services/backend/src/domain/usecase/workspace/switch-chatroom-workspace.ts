/**
 * Use Case: Switch Chatroom Workspace
 *
 * Rebinds a chatroom to one machine + folder inside the CALLER's mutation transaction
 * (`workspaces.switchWorkspace`). The caller owns authentication and machine ownership.
 * Any throw rolls back every write and enqueue.
 *
 * Required order: validate → conflict guard → no-op → stop agents → register target
 * → migrate configs → delete old config and status rows → deactivate old → set primary.
 * Stop must precede deactivation (the stop path only sees ACTIVE rows). Config copy must
 * precede removal (removal purges configs of the removed workspace).
 */

import { ConvexError } from 'convex/values';

import { disableFileTreeSyncLifecycle } from './disable-file-tree-sync-lifecycle';
import { getPrimaryWorkspaceForChatroom } from './get-primary-workspace-for-chatroom';
import { registerWorkspace } from './register-workspace';
import { removeWorkspace } from './remove-workspace';
import { setPrimaryWorkspaceSelection } from './set-primary-workspace-selection';
import { BACKEND_ERROR_CODES, type BackendError } from '../../../../config/errorCodes';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';
import type { AgentHarness } from '../../entities/agent';
import { isActiveWorkspace } from '../../entities/workspace';
import { getLastSentLaunchRequestForRole } from '../agent/get-last-sent-launch-request';
import { recordLastSentLaunchRequest } from '../agent/record-last-sent-launch-request';
import { requestChatroomWorkspaceAgentStop } from '../agent/request-chatroom-workspace-agent-stop';
import { requestBelongsToWorkspace } from '../agent/workspace-match';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConfigSkipReason = 'harness_unavailable' | 'target_has_config' | 'not_remote';

export interface SwitchChatroomWorkspaceInput {
  chatroomId: Id<'chatroom_rooms'>;
  /** Target machine. The caller has already verified owner access. */
  machine: Doc<'chatroom_machines'>;
  /** Raw folder path; normalized here. */
  workingDir: string;
  /** undefined = skip guard; null = expect no active workspace; id = expect that workspace. */
  expectedWorkspaceId?: Id<'chatroom_workspaces'> | null | undefined;
  requestedBy: Id<'users'>;
}

export interface SwitchChatroomWorkspaceResult {
  outcome: 'switched' | 'unchanged';
  workspaceId: Id<'chatroom_workspaces'>;
  machineId: string;
  workingDir: string;
  previousWorkspaceIds: Id<'chatroom_workspaces'>[];
  agentsStopRequested: boolean;
  configsMigrated: string[];
  configsSkipped: { role: string; reason: ConfigSkipReason }[];
}

// ─── Use Case ────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export async function switchChatroomWorkspace(
  ctx: MutationCtx,
  input: SwitchChatroomWorkspaceInput
): Promise<SwitchChatroomWorkspaceResult> {
  const { chatroomId, machine } = input;
  const now = Date.now();

  // 1. Validate (no writes yet). Throws ConvexError INVALID_WORKING_DIR.
  const workingDir = normalizeTargetWorkingDir(input.workingDir);

  const active = (
    await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  ).filter((ws) => isActiveWorkspace(ws.removedAt));

  // 2. Conflict guard: effective current workspace (primary pointer, newest-active fallback).
  const current = await getPrimaryWorkspaceForChatroom(ctx, chatroomId);
  if (
    input.expectedWorkspaceId !== undefined &&
    (current?._id ?? null) !== input.expectedWorkspaceId
  ) {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.WORKSPACE_SWITCH_CONFLICT,
      message: 'The chatroom workspace changed. Reload and try again.',
    });
  }

  // 3. No-op: exactly one active row already equals the target.
  const [only] = active;
  if (
    active.length === 1 &&
    only &&
    only.machineId === machine.machineId &&
    only.workingDir === workingDir
  ) {
    await ensurePrimaryWorkspace(ctx, chatroomId, only._id); // writes only if the pointer differs
    return {
      outcome: 'unchanged',
      workspaceId: only._id,
      machineId: only.machineId,
      workingDir: only.workingDir,
      previousWorkspaceIds: [],
      agentsStopRequested: false,
      configsMigrated: [],
      configsSkipped: [],
    };
  }

  // 4. Stop agents on every currently active workspace (before deactivation).
  const stop = await requestChatroomWorkspaceAgentStop(ctx, { chatroomId });

  // 5. Register (or reactivate) the target. Existing active target is a no-op.
  const workspaceId = await registerWorkspace(ctx, {
    chatroomId,
    machineId: machine.machineId,
    workingDir,
    hostname: machine.hostname,
    registeredBy: 'user',
  });
  const previous = active.filter((ws) => ws._id !== workspaceId);
  await carryFileTreeSyncPreference(ctx, workspaceId, previous);

  // 6. Copy configs to the target, then delete the old ones (snapshot-based).
  const capabilities = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', machine.machineId))
    .first();
  const configs = await migrateLaunchConfigs(ctx, {
    chatroomId,
    target: { workspaceId, machineId: machine.machineId, workingDir },
    harnesses: capabilities?.availableHarnesses ?? [],
    previous,
    requestedBy: input.requestedBy,
    now,
  });

  // 7. Delete role-status rows that reference a departing workspace.
  await deleteStatusRowsForWorkspaces(ctx, chatroomId, previous);

  // 8. Deactivate the previous active workspaces (soft delete + cache purge).
  for (const ws of previous) {
    if (ws.fileTreeSyncEnabled === true) await disableFileTreeSyncLifecycle(ctx, ws, now);
    await removeWorkspace(ctx, { workspaceId: ws._id });
  }

  // 9. Primary pointer → target.
  await setPrimaryWorkspaceSelection(ctx, { chatroomId, workspaceId });

  return {
    outcome: 'switched',
    workspaceId,
    machineId: machine.machineId,
    workingDir,
    previousWorkspaceIds: previous.map((ws) => ws._id),
    agentsStopRequested: stop.commandIds.length > 0,
    configsMigrated: configs.migrated,
    configsSkipped: configs.skipped,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeTargetWorkingDir(workingDir: string): string {
  try {
    return normalizeWorkingDir(workingDir);
  } catch (err) {
    throw new ConvexError<BackendError>({
      code: BACKEND_ERROR_CODES.INVALID_WORKING_DIR,
      message: err instanceof Error ? err.message : 'Invalid working directory',
    });
  }
}

async function ensurePrimaryWorkspace(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  workspaceId: Id<'chatroom_workspaces'>
): Promise<void> {
  const pointer = await ctx.db
    .query('chatroom_primaryWorkspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  if (pointer?.workspaceId !== workspaceId) {
    await setPrimaryWorkspaceSelection(ctx, { chatroomId, workspaceId });
  }
}

/** Target inherits the file-tree sync preference of the workspaces it replaces. */
async function carryFileTreeSyncPreference(
  ctx: MutationCtx,
  workspaceId: Id<'chatroom_workspaces'>,
  previous: readonly Doc<'chatroom_workspaces'>[]
): Promise<void> {
  const carried = previous.some((ws) => ws.fileTreeSyncEnabled === true);
  const target = await ctx.db.get('chatroom_workspaces', workspaceId);
  if (target && (target.fileTreeSyncEnabled === true) !== carried) {
    await ctx.db.patch('chatroom_workspaces', workspaceId, { fileTreeSyncEnabled: carried });
  }
}

type ConfigMigration = {
  migrated: string[];
  skipped: { role: string; reason: ConfigSkipReason }[];
};

/**
 * Copies the newest launch config per (teamStructureId, role) that belongs to a departing
 * workspace onto the target, then deletes EVERY belonging row (including skipped and legacy
 * un-scoped rows). Works from a snapshot taken before any copy is written.
 */
// fallow-ignore-next-line complexity
async function migrateLaunchConfigs(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    target: { workspaceId: Id<'chatroom_workspaces'>; machineId: string; workingDir: string };
    harnesses: readonly AgentHarness[];
    previous: readonly Doc<'chatroom_workspaces'>[];
    requestedBy: Id<'users'>;
    now: number;
  }
): Promise<ConfigMigration> {
  const rows = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();
  const belonging = rows.filter((row) =>
    input.previous.some((ws) => requestBelongsToWorkspace(row, ws))
  );

  const newestPerRole = new Map<string, Doc<'chatroom_agentLastSentLaunchRequests'>>();
  for (const row of [...belonging].sort((a, b) => b.requestedAt - a.requestedAt)) {
    const key = `${row.teamStructureId}:${row.role.trim().toLowerCase()}`;
    if (!newestPerRole.has(key)) newestPerRole.set(key, row);
  }

  const result: ConfigMigration = { migrated: [], skipped: [] };
  for (const row of newestPerRole.values()) {
    const reason = await carryLaunchConfig(ctx, input, row);
    if (reason) result.skipped.push({ role: row.role, reason });
    else result.migrated.push(row.role);
  }

  for (const row of belonging) {
    await ctx.db.delete('chatroom_agentLastSentLaunchRequests', row._id);
  }
  return result;
}

/** Returns null when copied, or the skip reason. Precedence: not_remote, harness_unavailable, target_has_config. */
async function carryLaunchConfig(
  ctx: MutationCtx,
  input: {
    chatroomId: Id<'chatroom_rooms'>;
    target: { workspaceId: Id<'chatroom_workspaces'>; machineId: string; workingDir: string };
    harnesses: readonly AgentHarness[];
    requestedBy: Id<'users'>;
    now: number;
  },
  row: Doc<'chatroom_agentLastSentLaunchRequests'>
): Promise<ConfigSkipReason | null> {
  if (row.agentType !== 'remote') return 'not_remote';
  if (!input.harnesses.includes(row.agentHarness)) return 'harness_unavailable';
  const existing = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: input.chatroomId,
    role: row.role,
    teamStructureId: row.teamStructureId,
    workspaceId: input.target.workspaceId,
  });
  if (existing) return 'target_has_config';

  const requestId = crypto.randomUUID();
  await recordLastSentLaunchRequest(ctx, {
    requestId,
    commandId: `configuration:${requestId}`,
    chatroomId: input.chatroomId,
    teamStructureId: row.teamStructureId,
    role: row.role,
    agentType: 'remote',
    machineId: input.target.machineId,
    workspaceId: input.target.workspaceId,
    agentHarness: row.agentHarness,
    model: row.model,
    workingDir: input.target.workingDir,
    reason: 'workspace.switch',
    wantResume: false,
    requestedBy: input.requestedBy,
    requestedAt: input.now,
  });
  return null;
}

/** Deletes role-status rows scoped to a departing workspace, and legacy un-scoped rows on a departing machine. */
// fallow-ignore-next-line complexity
async function deleteStatusRowsForWorkspaces(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  previous: readonly Doc<'chatroom_workspaces'>[]
): Promise<void> {
  if (previous.length === 0) return;
  const previousIds = new Set<string>(previous.map((ws) => ws._id));
  const previousMachineIds = new Set<string>(previous.map((ws) => ws.machineId));
  const statusRows = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  for (const row of statusRows) {
    const scoped = row.workspaceId !== undefined && previousIds.has(row.workspaceId);
    const legacy =
      row.workspaceId === undefined &&
      row.machineId !== undefined &&
      previousMachineIds.has(row.machineId);
    if (scoped || legacy) {
      await ctx.db.delete('chatroom_agentRoleStatusReadModel', row._id);
    }
  }
}
