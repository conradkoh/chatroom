/**
 * Use Case: Sync Custom Agent Definitions
 *
 * The daemon is the only writer. A push carries one source snapshot
 * (`machineId` + `scope` + `workingDir`) and the full set of definitions it
 * found. This use case validates each definition, rejects invalid ones without
 * dropping valid siblings, and diffs the accepted set against stored rows so an
 * unchanged push writes nothing.
 */

import {
  CUSTOM_AGENT_LIMITS,
  sanitizeCustomAgentSummary,
  validateCustomAgentPayload,
  type CustomAgentDefinitionPayload,
  type CustomAgentIssue,
  type CustomAgentIssueReason,
  type CustomAgentScope,
} from '@workspace/shared/domain/custom-agent';
import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export interface SyncCustomAgentDefinitionsInput {
  machineId: string;
  scope: CustomAgentScope;
  workingDir?: string;
  contentHash: string;
  agents: CustomAgentDefinitionPayload[];
  issues: CustomAgentIssue[];
}

export interface RejectedCustomAgent {
  name: string;
  reason: CustomAgentIssueReason;
}

export interface SyncCustomAgentDefinitionsResult {
  applied: boolean;
  rejected: RejectedCustomAgent[];
}

/** Identity fields shared by a source row and its agent rows. */
type SourceKey = {
  machineId: string;
  scope: CustomAgentScope;
  workingDir?: string;
};

function invalidScope(message: string): ConvexError<{ code: 'INVALID_SCOPE'; message: string }> {
  return new ConvexError({ code: 'INVALID_SCOPE', message });
}

/**
 * A workspace source must name its directory; a machine source must not, so the
 * two scopes can never collide on the same index key.
 */
function assertScopeMatchesWorkingDir(input: SyncCustomAgentDefinitionsInput): void {
  const requiresWorkingDir = input.scope === 'workspace';
  if ((input.workingDir !== undefined) === requiresWorkingDir) return;
  throw invalidScope(
    requiresWorkingDir
      ? 'Workspace-scoped custom agents require a workingDir'
      : 'Machine-scoped custom agents must not include a workingDir'
  );
}

function assertWithinLimits(input: SyncCustomAgentDefinitionsInput): void {
  if (input.agents.length > CUSTOM_AGENT_LIMITS.agentsPerSource) {
    throw invalidScope(`Too many custom agents (max ${CUSTOM_AGENT_LIMITS.agentsPerSource})`);
  }
  if (input.issues.length > CUSTOM_AGENT_LIMITS.issuesPerSource) {
    throw invalidScope(`Too many custom agent issues (max ${CUSTOM_AGENT_LIMITS.issuesPerSource})`);
  }
}

/** Positional form makes the serialization independent of object key order. */
function issueKey(issue: CustomAgentIssue): string {
  return JSON.stringify([issue.path, issue.reason, issue.detail ?? null]);
}

function compareIssueKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Canonical issue order and serialization. Two pushes reporting the same issues
 * in a different filesystem order must still compare equal.
 */
function canonicalizeIssues(issues: readonly CustomAgentIssue[]): {
  issues: CustomAgentIssue[];
  json: string;
} {
  const sorted = [...issues].sort((left, right) =>
    compareIssueKeys(issueKey(left), issueKey(right))
  );
  return {
    issues: sorted,
    json: JSON.stringify(sorted.map((issue) => [issue.path, issue.reason, issue.detail ?? null])),
  };
}

type ValidationResult =
  | { accepted: true; definition: CustomAgentDefinitionPayload }
  | { accepted: false; rejected: RejectedCustomAgent; issue: CustomAgentIssue };

/** Validates one definition and sanitizes the display summary of accepted agents. */
function validateAgent(agent: CustomAgentDefinitionPayload): ValidationResult {
  const validation = validateCustomAgentPayload(agent);
  if (!validation.ok) {
    return {
      accepted: false,
      rejected: { name: agent.name, reason: validation.reason },
      issue: {
        path: agent.name,
        reason: validation.reason,
        ...(validation.detail !== undefined ? { detail: validation.detail } : {}),
      },
    };
  }
  return {
    accepted: true,
    definition: { ...agent, description: sanitizeCustomAgentSummary(agent.description) },
  };
}

function partitionAgents(agents: readonly CustomAgentDefinitionPayload[]): {
  accepted: CustomAgentDefinitionPayload[];
  rejected: RejectedCustomAgent[];
  issues: CustomAgentIssue[];
} {
  const accepted: CustomAgentDefinitionPayload[] = [];
  const rejected: RejectedCustomAgent[] = [];
  const issues: CustomAgentIssue[] = [];

  for (const agent of agents) {
    const result = validateAgent(agent);
    if (result.accepted) {
      accepted.push(result.definition);
    } else {
      rejected.push(result.rejected);
      issues.push(result.issue);
    }
  }

  return { accepted, rejected, issues };
}

async function findSource(
  ctx: MutationCtx,
  key: SourceKey
): Promise<Doc<'chatroom_customAgentSources'> | null> {
  const row = await ctx.db
    .query('chatroom_customAgentSources')
    .withIndex('by_machine_scope_workingDir', (q) =>
      q.eq('machineId', key.machineId).eq('scope', key.scope).eq('workingDir', key.workingDir)
    )
    .first();
  return row ?? null;
}

async function upsertSource(
  ctx: MutationCtx,
  key: SourceKey,
  existing: Doc<'chatroom_customAgentSources'> | null,
  snapshot: {
    contentHash: string;
    agentCount: number;
    issues: CustomAgentIssue[];
    updatedAt: number;
  }
): Promise<Id<'chatroom_customAgentSources'>> {
  if (existing) {
    await ctx.db.patch('chatroom_customAgentSources', existing._id, snapshot);
    return existing._id;
  }
  return ctx.db.insert('chatroom_customAgentSources', {
    ...key,
    ...snapshot,
  });
}

async function deleteContentRows(
  ctx: MutationCtx,
  customAgentId: Id<'chatroom_customAgents'>
): Promise<void> {
  const contents = await ctx.db
    .query('chatroom_customAgentContents')
    .withIndex('by_customAgent', (q) => q.eq('customAgentId', customAgentId))
    .collect();
  for (const content of contents) {
    await ctx.db.delete('chatroom_customAgentContents', content._id);
  }
}

async function insertContentRow(
  ctx: MutationCtx,
  customAgentId: Id<'chatroom_customAgents'>,
  definition: CustomAgentDefinitionPayload
): Promise<void> {
  await ctx.db.insert('chatroom_customAgentContents', {
    customAgentId,
    systemPrompt: definition.systemPrompt,
    ...(definition.inboundHandoffTemplate !== undefined
      ? { inboundHandoffTemplate: definition.inboundHandoffTemplate }
      : {}),
    ...(definition.returnHandoffTemplate !== undefined
      ? { returnHandoffTemplate: definition.returnHandoffTemplate }
      : {}),
  });
}

async function replaceContentRows(
  ctx: MutationCtx,
  customAgentId: Id<'chatroom_customAgents'>,
  definition: CustomAgentDefinitionPayload
): Promise<void> {
  await deleteContentRows(ctx, customAgentId);
  await insertContentRow(ctx, customAgentId, definition);
}

async function insertAgent(
  ctx: MutationCtx,
  key: SourceKey,
  sourceId: Id<'chatroom_customAgentSources'>,
  definition: CustomAgentDefinitionPayload,
  updatedAt: number
): Promise<void> {
  const customAgentId = await ctx.db.insert('chatroom_customAgents', {
    sourceId,
    ...key,
    name: definition.name,
    description: definition.description,
    contentHash: definition.contentHash,
    updatedAt,
  });
  await insertContentRow(ctx, customAgentId, definition);
}

async function patchAgent(
  ctx: MutationCtx,
  existing: Doc<'chatroom_customAgents'>,
  definition: CustomAgentDefinitionPayload,
  updatedAt: number
): Promise<void> {
  await ctx.db.patch('chatroom_customAgents', existing._id, {
    description: definition.description,
    contentHash: definition.contentHash,
    updatedAt,
  });
  await replaceContentRows(ctx, existing._id, definition);
}

async function deleteAgent(
  ctx: MutationCtx,
  existing: Doc<'chatroom_customAgents'>
): Promise<void> {
  await deleteContentRows(ctx, existing._id);
  await ctx.db.delete('chatroom_customAgents', existing._id);
}

/** Removes stored agents absent from the pushed snapshot. */
async function deleteMissingAgents(
  ctx: MutationCtx,
  existing: readonly Doc<'chatroom_customAgents'>[],
  acceptedNames: ReadonlySet<string>
): Promise<void> {
  for (const agent of existing) {
    if (!acceptedNames.has(agent.name)) await deleteAgent(ctx, agent);
  }
}

/** Inserts new agents and patches only agents whose content hash changed. */
async function applyAcceptedAgents(
  ctx: MutationCtx,
  key: SourceKey,
  sourceId: Id<'chatroom_customAgentSources'>,
  accepted: readonly CustomAgentDefinitionPayload[],
  existingByName: ReadonlyMap<string, Doc<'chatroom_customAgents'>>,
  updatedAt: number
): Promise<void> {
  for (const definition of accepted) {
    const current = existingByName.get(definition.name);
    if (!current) {
      await insertAgent(ctx, key, sourceId, definition, updatedAt);
    } else if (current.contentHash !== definition.contentHash) {
      await patchAgent(ctx, current, definition, updatedAt);
    }
  }
}

/**
 * Reconciles stored agent rows with the accepted definitions.
 *
 * Unchanged per-agent hashes leave their identity and content rows untouched, so
 * `updatedAt` only moves for rows that actually changed.
 */
async function reconcileAgents(
  ctx: MutationCtx,
  key: SourceKey,
  sourceId: Id<'chatroom_customAgentSources'>,
  accepted: readonly CustomAgentDefinitionPayload[],
  updatedAt: number
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_customAgents')
    .withIndex('by_source', (q) => q.eq('sourceId', sourceId))
    .collect();
  const existingByName = new Map(existing.map((agent) => [agent.name, agent]));
  const acceptedNames = new Set(accepted.map((agent) => agent.name));

  await deleteMissingAgents(ctx, existing, acceptedNames);
  await applyAcceptedAgents(ctx, key, sourceId, accepted, existingByName, updatedAt);
}

/** Narrows the push payload to the source index key. */
function toSourceKey(input: SyncCustomAgentDefinitionsInput): SourceKey {
  return {
    machineId: input.machineId,
    scope: input.scope,
    ...(input.workingDir !== undefined ? { workingDir: input.workingDir } : {}),
  };
}

function isUnchangedSnapshot(
  existing: Doc<'chatroom_customAgentSources'> | null,
  contentHash: string,
  issuesJson: string
): boolean {
  if (existing === null) return false;
  if (existing.contentHash !== contentHash) return false;
  return canonicalizeIssues(existing.issues).json === issuesJson;
}

/** An identical content hash means only the reported issues changed. */
function needsAgentReconcile(
  existing: Doc<'chatroom_customAgentSources'> | null,
  contentHash: string
): boolean {
  return existing === null || existing.contentHash !== contentHash;
}

async function writeSnapshot(
  ctx: MutationCtx,
  key: SourceKey,
  existing: Doc<'chatroom_customAgentSources'> | null,
  input: {
    contentHash: string;
    accepted: CustomAgentDefinitionPayload[];
    issues: CustomAgentIssue[];
  }
): Promise<void> {
  const now = Date.now();
  const sourceId = await upsertSource(ctx, key, existing, {
    contentHash: input.contentHash,
    agentCount: input.accepted.length,
    issues: input.issues,
    updatedAt: now,
  });
  if (needsAgentReconcile(existing, input.contentHash)) {
    await reconcileAgents(ctx, key, sourceId, input.accepted, now);
  }
}

export async function syncCustomAgentDefinitions(
  ctx: MutationCtx,
  input: SyncCustomAgentDefinitionsInput
): Promise<SyncCustomAgentDefinitionsResult> {
  assertScopeMatchesWorkingDir(input);
  assertWithinLimits(input);

  const validated = partitionAgents(input.agents);
  const canonical = canonicalizeIssues([...input.issues, ...validated.issues]);
  const key = toSourceKey(input);
  const existingSource = await findSource(ctx, key);
  if (isUnchangedSnapshot(existingSource, input.contentHash, canonical.json)) {
    return { applied: false, rejected: validated.rejected };
  }

  await writeSnapshot(ctx, key, existingSource, {
    contentHash: input.contentHash,
    accepted: validated.accepted,
    issues: canonical.issues,
  });
  return { applied: true, rejected: validated.rejected };
}
