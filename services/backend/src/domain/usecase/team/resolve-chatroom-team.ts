/**
 * Use Case: Resolve Chatroom Team
 *
 * The single merge point between the immutable builtin team structure and the
 * custom agents pushed for the chatroom's primary workspace. Every team read
 * goes through here so precedence, limits, and machine-local disabling stay in
 * one place.
 *
 * Read budget per resolution (keep exact):
 *   1. chatroom_activeTeamStructures.by_chatroom        (1 row)
 *   2. primary workspace                                 (1 workspace)
 *   3. custom agents, workspace scope                    (take 12)
 *   4. custom agents, machine scope                      (take 12)
 *
 * Steps 3 and 4 are skipped for teams that cannot carry custom agents (solo)
 * and for chatrooms without a primary workspace.
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
  supportsCustomAgents,
  validateCustomAgentName,
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

export interface ResolvedCustomAgent extends CustomAgentIdentity {
  customAgentId: Id<'chatroom_customAgents'>;
  machineId: string;
  workingDir?: string;
  hasInboundHandoffTemplate: boolean;
  hasReturnHandoffTemplate: boolean;
}

export interface ResolveChatroomTeamOptions {
  /** Legacy persisted roles for non-preset structure ids (start paths only). */
  legacyRoom?: Pick<Doc<'chatroom_rooms'>, 'teamRoles' | 'teamEntryPoint'> | null;
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
      hasInboundHandoffTemplate: row.hasInboundHandoffTemplate,
      hasReturnHandoffTemplate: row.hasReturnHandoffTemplate,
    };
  });
}

/** Custom agents only resolve for teams that support them and for chatrooms with a workspace. */
function readAgentRows(
  ctx: DbCtx,
  base: TeamStructure,
  primaryWorkspace: Doc<'chatroom_workspaces'> | null
): Promise<[CustomAgentRow[], CustomAgentRow[]]> {
  if (!primaryWorkspace || !supportsCustomAgents(base.teamId)) {
    return Promise.resolve([[], []]);
  }
  return Promise.all([
    readCustomAgents(ctx, primaryWorkspace.machineId, 'workspace', primaryWorkspace.workingDir),
    readCustomAgents(ctx, primaryWorkspace.machineId, 'machine', undefined),
  ]);
}

/**
 * Machine-local disable is stamped onto each pushed definition, so the rows the
 * resolver already loads are the projection: no separate disabled-roles read.
 */
function collectDisabledRoles(
  workspaceRows: readonly CustomAgentRow[],
  machineRows: readonly CustomAgentRow[]
): Set<string> {
  return new Set(
    [...workspaceRows, ...machineRows].filter((row) => row.disabled).map((row) => row.name)
  );
}

/**
 * Legacy assignments carry their roles on the room row itself, which only the
 * start paths pass in. `getTeamStructure` ignores these fields for preset ids.
 * Null is passed (not undefined) because the builder rejects undefined under
 * `exactOptionalPropertyTypes`.
 */
function legacyPersistedRoles(options?: ResolveChatroomTeamOptions): readonly string[] | null {
  return options?.legacyRoom?.teamRoles ?? null;
}

function legacyPersistedEntryPoint(options?: ResolveChatroomTeamOptions): string | null {
  return options?.legacyRoom?.teamEntryPoint ?? null;
}

/**
 * Resolves the chatroom's active team plus its custom agents, or null when the
 * chatroom has no active team assignment.
 *
 * `options.legacyRoom` supplies persisted roles for structure ids that are not
 * presets. Normal reads pass nothing; start paths pass the room so a legacy
 * assignment keeps its roles.
 */
export async function resolveChatroomTeam(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>,
  options?: ResolveChatroomTeamOptions
): Promise<ResolvedChatroomTeam | null> {
  const active = await getActiveTeamStructure(ctx, chatroomId);
  if (!active) return null;

  const base = getTeamStructure({
    teamId: active.teamStructureId,
    persistedRoles: legacyPersistedRoles(options),
    persistedEntryPoint: legacyPersistedEntryPoint(options),
  });
  const primaryWorkspace = await getPrimaryWorkspaceForChatroom(ctx, chatroomId);
  const [workspaceRows, machineRows] = await readAgentRows(ctx, base, primaryWorkspace);

  const merged = mergeTeamStructureWithCustomAgents({
    base,
    workspaceAgents: workspaceRows.map(toIdentity),
    machineAgents: machineRows.map(toIdentity),
    disabledRoles: collectDisabledRoles(workspaceRows, machineRows),
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
  chatroomId: Id<'chatroom_rooms'>,
  options?: ResolveChatroomTeamOptions
): Promise<TeamStructure | null> {
  const resolved = await resolveChatroomTeam(ctx, chatroomId, options);
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
 * Whether the role was already projected as ephemeral in this chatroom.
 *
 * A role projected as ephemeral stays ephemeral after its definition is removed
 * or disabled (M1). The projection is written while the definition still exists,
 * so this single indexed read on the cold path is enough; no scan of in-flight
 * tasks is needed. Never add an index here.
 */
async function hasEphemeralStatusProjection(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  const row = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .first();
  return row?.roleKind === 'ephemeral';
}

/**
 * Whether the role should be treated as an ephemeral agent in this chatroom.
 *
 * Builtin lifecycle tags are authoritative. `user` and retired roles are never
 * agents. Any other name is a custom role only when the primary workspace has a
 * stored definition for it, whether or not that role is currently disabled.
 *
 * A role projected as ephemeral stays ephemeral after its definition is removed
 * or disabled (M1), so the release path still runs for an in-flight custom role.
 *
 * Consumed by the ephemeral lifecycle call sites (release, register, status
 * projection, inbox events, and assigned-task reads), so a custom role gets the
 * same ephemeral behaviour as a builtin one.
 */
export async function isEphemeralRoleInChatroom(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  const builtinDecision = builtinEphemeralDecision(role);
  if (builtinDecision !== null) return builtinDecision;
  return isCustomAgentRoleInChatroom(ctx, chatroomId, role);
}

/**
 * Custom-role half of `isEphemeralRoleInChatroom`.
 *
 * Names that fail `validateCustomAgentName` (malformed or reserved) never become
 * ephemeral, so a random role string cannot borrow the ephemeral lifecycle. A
 * definition row wins; otherwise the projected lifecycle is the sticky fallback.
 */
async function isCustomAgentRoleInChatroom(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  if (validateCustomAgentName(role) !== null) return false; // malformed or reserved names are never custom agents

  const workspace = await getPrimaryWorkspaceForChatroom(ctx, chatroomId);
  if (workspace !== null && (await hasCustomAgentDefinition(ctx, workspace, role))) return true;
  return hasEphemeralStatusProjection(ctx, chatroomId, role);
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
