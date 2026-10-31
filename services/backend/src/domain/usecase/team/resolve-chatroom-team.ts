/**
 * Use Case: Resolve Chatroom Team
 *
 * The single merge point between the immutable builtin team structure and the
 * custom agents pushed for the chatroom's primary workspace. Every team read
 * goes through here so precedence, limits, and per-chatroom disabling stay in
 * one place.
 *
 * Read budget per resolution (keep exact):
 *   1. chatroom_activeTeamStructures.by_chatroom        (1 row)
 *   2. primary workspace                                 (1 workspace)
 *   3. custom agents, workspace scope                    (take 12)
 *   4. custom agents, machine scope                      (take 12)
 *   5. disabled roles for the chatroom                   (take 64)
 *
 * Source and content tables are deliberately not read here: source issues
 * belong to the settings query, and prompts belong to prompt composition.
 */

import {
  isBuiltinAgentRole,
  isEphemeralAgentRole,
  isRetiredAgentRole,
} from '@workspace/shared/domain/agent-role';
import {
  CUSTOM_AGENT_LIMITS,
  mergeTeamStructureWithCustomAgents,
  type CustomAgentIdentity,
  type CustomAgentScope,
  type MergedTeam,
} from '@workspace/shared/domain/custom-agent';
import { getTeamStructure, type TeamStructure } from '@workspace/shared/domain/team-presets';

import { getActiveTeamStructure } from './active-team-structure';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { getPrimaryWorkspaceForChatroom } from '../workspace/get-primary-workspace-for-chatroom';

type DbCtx = MutationCtx | QueryCtx;

const DISABLED_ROLES_READ_LIMIT = 64;

export interface ResolvedCustomAgent extends CustomAgentIdentity {
  customAgentId: Id<'chatroom_customAgents'>;
  machineId: string;
  workingDir?: string;
}

export interface ResolvedChatroomTeam extends Omit<MergedTeam, 'enabledCustomAgents'> {
  enabledCustomAgents: ResolvedCustomAgent[];
  primaryWorkspace: Doc<'chatroom_workspaces'> | null;
}

type CustomAgentRow = Doc<'chatroom_customAgents'>;

function toIdentity(row: CustomAgentRow): CustomAgentIdentity {
  return { name: row.name, description: row.description, scope: row.scope };
}

function readCustomAgents(
  ctx: DbCtx,
  machineId: string,
  scope: CustomAgentScope,
  workingDir: string | undefined
): Promise<CustomAgentRow[]> {
  return ctx.db
    .query('chatroom_customAgents')
    .withIndex('by_machine_scope_workingDir_name', (q) =>
      q.eq('machineId', machineId).eq('scope', scope).eq('workingDir', workingDir)
    )
    .take(CUSTOM_AGENT_LIMITS.agentsPerSource);
}

async function readDisabledRoles(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Set<string>> {
  const rows = await ctx.db
    .query('chatroom_disabledAgentRoles')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId))
    .take(DISABLED_ROLES_READ_LIMIT);
  return new Set(rows.map((row) => row.role));
}

/**
 * Reattaches stored ids and origin metadata to the identities the pure merge
 * kept. Workspace rows win the name lookup, mirroring merge precedence.
 */
function toResolvedCustomAgents(
  enabled: readonly CustomAgentIdentity[],
  workspaceRows: readonly CustomAgentRow[],
  machineRows: readonly CustomAgentRow[]
): ResolvedCustomAgent[] {
  const rowsByName = new Map<string, CustomAgentRow>();
  for (const row of [...workspaceRows, ...machineRows]) {
    if (!rowsByName.has(row.name)) rowsByName.set(row.name, row);
  }

  return enabled.map((identity) => {
    const row = rowsByName.get(identity.name);
    if (!row) throw new Error(`Resolved custom agent "${identity.name}" has no stored row`);
    return {
      ...identity,
      customAgentId: row._id,
      machineId: row.machineId,
      ...(row.workingDir !== undefined ? { workingDir: row.workingDir } : {}),
    };
  });
}

/**
 * Resolves the chatroom's active team plus its custom agents, or null when the
 * chatroom has no active team assignment.
 */
export async function resolveChatroomTeam(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ResolvedChatroomTeam | null> {
  const active = await getActiveTeamStructure(ctx, chatroomId);
  if (!active) return null;

  const primaryWorkspace = await getPrimaryWorkspaceForChatroom(ctx, chatroomId);
  const workspaceRows = primaryWorkspace
    ? await readCustomAgents(
        ctx,
        primaryWorkspace.machineId,
        'workspace',
        primaryWorkspace.workingDir
      )
    : [];
  const machineRows = primaryWorkspace
    ? await readCustomAgents(ctx, primaryWorkspace.machineId, 'machine', undefined)
    : [];
  const disabledRoles = await readDisabledRoles(ctx, chatroomId);

  const merged = mergeTeamStructureWithCustomAgents({
    base: getTeamStructure({ teamId: active.teamStructureId }),
    workspaceAgents: workspaceRows.map(toIdentity),
    machineAgents: machineRows.map(toIdentity),
    disabledRoles,
  });

  return {
    ...merged,
    enabledCustomAgents: toResolvedCustomAgents(
      merged.enabledCustomAgents,
      workspaceRows,
      machineRows
    ),
    primaryWorkspace,
  };
}

/** Resolves only the merged structure, for read models that never need the roster. */
export async function resolveChatroomTeamStructure(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<TeamStructure | null> {
  const resolved = await resolveChatroomTeam(ctx, chatroomId);
  return resolved?.structure ?? null;
}

/** Builtin answer, or null when the name can only be a custom role. */
function builtinEphemeralDecision(role: string): boolean | null {
  if (role === 'user' || isRetiredAgentRole(role)) return false;
  return isBuiltinAgentRole(role) ? isEphemeralAgentRole(role) : null;
}

async function hasCustomAgentDefinition(
  ctx: DbCtx,
  workspace: Doc<'chatroom_workspaces'>,
  role: string
): Promise<boolean> {
  const [workspaceRow, machineRow] = await Promise.all([
    findCustomAgentByName(ctx, workspace.machineId, 'workspace', workspace.workingDir, role),
    findCustomAgentByName(ctx, workspace.machineId, 'machine', undefined, role),
  ]);
  return workspaceRow !== null || machineRow !== null;
}

/**
 * Whether the role should be treated as an ephemeral agent in this chatroom.
 *
 * Builtin lifecycle tags are authoritative. `user` and retired roles are never
 * agents. Any other name is a custom role only when the primary workspace has a
 * stored definition for it, whether or not that role is currently disabled.
 *
 * Consumed by the prompt and CLI slices that follow; the check lives here once.
 */
// fallow-ignore-next-line unused-export
export async function isEphemeralRoleInChatroom(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  const builtinDecision = builtinEphemeralDecision(role);
  if (builtinDecision !== null) return builtinDecision;

  const workspace = await getPrimaryWorkspaceForChatroom(ctx, chatroomId);
  return workspace !== null && hasCustomAgentDefinition(ctx, workspace, role);
}

async function findCustomAgentByName(
  ctx: DbCtx,
  machineId: string,
  scope: CustomAgentScope,
  workingDir: string | undefined,
  name: string
): Promise<CustomAgentRow | null> {
  const row = await ctx.db
    .query('chatroom_customAgents')
    .withIndex('by_machine_scope_workingDir_name', (q) =>
      q.eq('machineId', machineId).eq('scope', scope).eq('workingDir', workingDir).eq('name', name)
    )
    .first();
  return row ?? null;
}
