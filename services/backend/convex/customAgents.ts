/**
 * Convex functions for custom agents.
 *
 * File-authored definitions reach Convex through `syncDefinitions`, which the
 * daemon calls as the machine owner. Disable state arrives only through
 * `syncDefinitions`: the daemon stamps it from its machine-local disable state,
 * and the resolver projects it onto the chatroom. Resolution and settings reads
 * live beside this module in the custom-agent use cases.
 */

import {
  CUSTOM_AGENT_LIMITS,
  type CustomAgentIssue,
  type CustomAgentScope,
} from '@workspace/shared/domain/custom-agent';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireSession } from './auth/session';
import { customAgentIssueValidator, customAgentScopeValidator } from './schema';
import { checkAccess } from '../modules/auth/accessCheck';
import { syncCustomAgentDefinitions } from '../src/domain/usecase/custom-agents/sync-custom-agent-definitions';
import {
  resolveChatroomTeam,
  type ResolvedChatroomTeam,
} from '../src/domain/usecase/team/resolve-chatroom-team';

const customAgentDefinitionValidator = v.object({
  name: v.string(),
  description: v.string(),
  systemPrompt: v.string(),
  inboundHandoffTemplate: v.optional(v.string()),
  returnHandoffTemplate: v.optional(v.string()),
  contentHash: v.string(),
  disabled: v.boolean(),
});

/**
 * Replaces the pushed definition snapshot for one machine source.
 *
 * The daemon is the only writer. An unchanged push is a no-op, and invalid
 * definitions are returned as rejections instead of failing the whole sync.
 */
export const syncDefinitions = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    scope: customAgentScopeValidator,
    workingDir: v.optional(v.string()),
    contentHash: v.string(),
    agents: v.array(customAgentDefinitionValidator),
    issues: v.array(customAgentIssueValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.sessionId);
    const ownerCheck = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'owner',
    });
    if (!ownerCheck.ok) {
      throw new ConvexError({
        code: 'NOT_AUTHORIZED_MACHINE',
        message: 'Not authorized for this machine',
      });
    }

    return syncCustomAgentDefinitions(ctx, args);
  },
});

type DbCtx = QueryCtx | MutationCtx;

type CustomAgentSourceView = {
  scope: CustomAgentScope;
  workingDir?: string;
  machineId: string;
  agentCount: number;
  issues: CustomAgentIssue[];
  updatedAt: number;
};

type ScopeAgentNames = {
  workspace: Set<string>;
  machine: Set<string>;
};

function toSourceView(source: Doc<'chatroom_customAgentSources'>): CustomAgentSourceView {
  return {
    scope: source.scope,
    ...(source.workingDir !== undefined ? { workingDir: source.workingDir } : {}),
    machineId: source.machineId,
    agentCount: source.agentCount,
    issues: source.issues,
    updatedAt: source.updatedAt,
  };
}

function isSource(
  source: Doc<'chatroom_customAgentSources'> | null
): source is Doc<'chatroom_customAgentSources'> {
  return source !== null;
}

function readSource(
  ctx: DbCtx,
  machineId: string,
  scope: CustomAgentScope,
  workingDir: string | undefined
): Promise<Doc<'chatroom_customAgentSources'> | null> {
  return ctx.db
    .query('chatroom_customAgentSources')
    .withIndex('by_machine_scope_workingDir', (q) =>
      q.eq('machineId', machineId).eq('scope', scope).eq('workingDir', workingDir)
    )
    .first();
}

async function readAgentNames(
  ctx: DbCtx,
  machineId: string,
  scope: CustomAgentScope,
  workingDir: string | undefined
): Promise<Set<string>> {
  const rows = await ctx.db
    .query('chatroom_customAgents')
    .withIndex('by_machine_scope_workingDir_name', (q) =>
      q.eq('machineId', machineId).eq('scope', scope).eq('workingDir', workingDir)
    )
    .take(CUSTOM_AGENT_LIMITS.agentsPerSource);
  return new Set(rows.map((row) => row.name));
}

/**
 * Shadowing and per-chatroom caps are computed by the pure merge, not stored on
 * a source. Attribute those computed issues to the source that owns the role:
 * a shadowed machine agent loses to the workspace row, and an over-limit agent
 * belongs to whichever scope defined it.
 */
function attributeMergeIssue(
  issue: CustomAgentIssue,
  names: ScopeAgentNames
): CustomAgentScope | null {
  // Shadowing is a machine loss; caps are attributed to whichever scope owns the role.
  const preference =
    issue.reason === 'shadowed'
      ? (['machine', 'workspace'] as const)
      : (['workspace', 'machine'] as const);
  return preference.find((scope) => names[scope].has(issue.path)) ?? null;
}

function withMergeIssues(
  sources: readonly CustomAgentSourceView[],
  mergeIssues: readonly CustomAgentIssue[],
  names: ScopeAgentNames
): CustomAgentSourceView[] {
  return sources.map((source) => ({
    ...source,
    issues: [
      ...source.issues,
      ...mergeIssues.filter((issue) => attributeMergeIssue(issue, names) === source.scope),
    ],
  }));
}

async function readSourcesForWorkspace(
  ctx: DbCtx,
  workspace: Doc<'chatroom_workspaces'>,
  mergeIssues: readonly CustomAgentIssue[]
): Promise<CustomAgentSourceView[]> {
  const [workspaceSource, machineSource, workspaceNames, machineNames] = await Promise.all([
    readSource(ctx, workspace.machineId, 'workspace', workspace.workingDir),
    readSource(ctx, workspace.machineId, 'machine', undefined),
    readAgentNames(ctx, workspace.machineId, 'workspace', workspace.workingDir),
    readAgentNames(ctx, workspace.machineId, 'machine', undefined),
  ]);

  const sources = [workspaceSource, machineSource].filter(isSource).map(toSourceView);
  return withMergeIssues(sources, mergeIssues, {
    workspace: workspaceNames,
    machine: machineNames,
  });
}

async function readResolvedSources(
  ctx: DbCtx,
  resolved: ResolvedChatroomTeam
): Promise<CustomAgentSourceView[]> {
  if (!resolved.primaryWorkspace) return [];
  return readSourcesForWorkspace(ctx, resolved.primaryWorkspace, resolved.issues);
}

async function buildTeamSettings(ctx: DbCtx, chatroomId: Id<'chatroom_rooms'>) {
  const resolved = await resolveChatroomTeam(ctx, chatroomId);
  if (!resolved) return { roster: [], sources: [] };
  return { roster: resolved.roster, sources: await readResolvedSources(ctx, resolved) };
}

/**
 * Chatroom settings view: every resolved role (including disabled ones) plus
 * the pushed source snapshots and their issues. This is the only query that
 * reads `chatroom_customAgentSources`.
 */
export const getTeamRoster = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return buildTeamSettings(ctx, args.chatroomId);
  },
});
