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
  CUSTOM_AGENT_ISSUE_TEXT_LIMIT,
  CUSTOM_AGENT_LIMITS,
  CUSTOM_AGENT_RULES_VERSION,
  computeCustomAgentContentHash,
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
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';

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

/**
 * Canonicalizes the workspace directory before it becomes an index key. The
 * resolver matches `workspace.workingDir` exactly, so a push for `/repo/` must
 * address the same rows as the workspace registered as `/repo`. Machine scope
 * never carries a directory. An invalid path throws the same error shape as the
 * other workspace mutations, which also call `normalizeWorkingDir`.
 */
function normalizeScopeWorkingDir(
  input: SyncCustomAgentDefinitionsInput
): SyncCustomAgentDefinitionsInput {
  if (input.workingDir === undefined) return input;
  return { ...input, workingDir: normalizeWorkingDir(input.workingDir) };
}

/** Positional form makes the serialization independent of object key order. */
function issueKey(issue: CustomAgentIssue): string {
  return JSON.stringify([issue.path, issue.reason, issue.detail ?? null]);
}

function compareIssueKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Clips one issue field to the stored text limit. Idempotent. */
function boundIssueText(text: string): string {
  return text.slice(0, CUSTOM_AGENT_ISSUE_TEXT_LIMIT);
}

function boundIssue(issue: CustomAgentIssue): CustomAgentIssue {
  return {
    path: boundIssueText(issue.path),
    reason: issue.reason,
    ...(issue.detail !== undefined ? { detail: boundIssueText(issue.detail) } : {}),
  };
}

/**
 * Canonical issue order and serialization. Two pushes reporting the same issues
 * in a different filesystem order must still compare equal. Every issue is
 * bounded before it is sorted or hashed, so the stored value and the comparison
 * hash always agree.
 */
function canonicalizeIssues(issues: readonly CustomAgentIssue[]): {
  issues: CustomAgentIssue[];
  json: string;
} {
  const sorted = issues
    .map(boundIssue)
    .sort((left, right) => compareIssueKeys(issueKey(left), issueKey(right)));
  return {
    issues: sorted,
    json: JSON.stringify(sorted.map((issue) => [issue.path, issue.reason, issue.detail ?? null])),
  };
}

/**
 * Merges client-reported issues with the server's own rejections.
 *
 * Server rejections are authoritative and always stored. The client list is
 * trimmed from the end of canonical order so the stored total obeys
 * `issuesPerSource` even when the client already pushed the maximum.
 */
function mergePushedIssues(
  clientIssues: readonly CustomAgentIssue[],
  serverIssues: readonly CustomAgentIssue[]
): CustomAgentIssue[] {
  const canonicalServer = canonicalizeIssues(serverIssues).issues;
  const canonicalClient = canonicalizeIssues(clientIssues).issues;
  const remaining = Math.max(0, CUSTOM_AGENT_LIMITS.issuesPerSource - canonicalServer.length);
  return [...canonicalClient.slice(0, remaining), ...canonicalServer];
}

type ValidationResult =
  | { accepted: true; definition: CustomAgentDefinitionPayload }
  | { accepted: false; rejected: RejectedCustomAgent; issue: CustomAgentIssue };

/**
 * Validates one definition, sanitizes the display summary of accepted agents,
 * and recomputes the per-agent hash from the stored fields. The pushed hash is
 * advisory: a stale one must never suppress a content update.
 */
function validateAgent(agent: CustomAgentDefinitionPayload): ValidationResult {
  const validation = validateCustomAgentPayload(agent);
  if (!validation.ok) {
    const name = boundIssueText(agent.name);
    return {
      accepted: false,
      rejected: { name, reason: validation.reason },
      issue: boundIssue({
        path: name,
        reason: validation.reason,
        ...(validation.detail !== undefined ? { detail: validation.detail } : {}),
      }),
    };
  }
  const description = sanitizeCustomAgentSummary(agent.description);
  const content = { ...agent, description };
  return {
    accepted: true,
    definition: { ...content, contentHash: computeCustomAgentContentHash(content) },
  };
}

/**
 * Splits the pushed agents into accepted and rejected sets. A name that appears
 * more than once in one push keeps its first valid occurrence; later ones are
 * rejected as `shadowed` so a duplicate can never overwrite the stored row.
 * Names are validated first, so an invalid duplicate is never recorded as seen.
 */
function partitionAgents(agents: readonly CustomAgentDefinitionPayload[]): {
  accepted: CustomAgentDefinitionPayload[];
  rejected: RejectedCustomAgent[];
  issues: CustomAgentIssue[];
} {
  const accepted: CustomAgentDefinitionPayload[] = [];
  const rejected: RejectedCustomAgent[] = [];
  const issues: CustomAgentIssue[] = [];
  const seenNames = new Set<string>();

  for (const agent of agents) {
    const result = validateAgent(agent);
    if (!result.accepted) {
      rejected.push(result.rejected);
      issues.push(result.issue);
      continue;
    }
    if (seenNames.has(result.definition.name)) {
      rejected.push({ name: result.definition.name, reason: 'shadowed' });
      issues.push({
        path: result.definition.name,
        reason: 'shadowed',
        detail: 'duplicate name in one push',
      });
      continue;
    }
    seenNames.add(result.definition.name);
    accepted.push(result.definition);
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
    rulesVersion: string;
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
  const templates = await ctx.db
    .query('chatroom_customAgentHandoffTemplates')
    .withIndex('by_customAgent_direction', (q) => q.eq('customAgentId', customAgentId))
    .take(2);
  for (const template of templates) {
    await ctx.db.delete('chatroom_customAgentHandoffTemplates', template._id);
  }
}

async function insertContentRows(
  ctx: MutationCtx,
  customAgentId: Id<'chatroom_customAgents'>,
  definition: CustomAgentDefinitionPayload
): Promise<void> {
  await ctx.db.insert('chatroom_customAgentContents', {
    customAgentId,
    systemPrompt: definition.systemPrompt,
  });
  const templates: readonly [direction: 'inbound' | 'return', body: string | undefined][] = [
    ['inbound', definition.inboundHandoffTemplate],
    ['return', definition.returnHandoffTemplate],
  ];
  for (const [direction, body] of templates) {
    if (body === undefined) continue;
    await ctx.db.insert('chatroom_customAgentHandoffTemplates', {
      customAgentId,
      direction,
      body,
    });
  }
}

/** Rewrites both body tables for one agent. A disabled-only change must not call this. */
async function replaceContentRows(
  ctx: MutationCtx,
  customAgentId: Id<'chatroom_customAgents'>,
  definition: CustomAgentDefinitionPayload
): Promise<void> {
  await deleteContentRows(ctx, customAgentId);
  await insertContentRows(ctx, customAgentId, definition);
}

/** Identity fields written on both insert and patch. */
function toIdentityFields(
  definition: CustomAgentDefinitionPayload,
  updatedAt: number
): {
  description: string;
  contentHash: string;
  disabled: boolean;
  hasInboundHandoffTemplate: boolean;
  hasReturnHandoffTemplate: boolean;
  updatedAt: number;
} {
  return {
    description: definition.description,
    contentHash: definition.contentHash,
    disabled: definition.disabled,
    hasInboundHandoffTemplate: definition.inboundHandoffTemplate !== undefined,
    hasReturnHandoffTemplate: definition.returnHandoffTemplate !== undefined,
    updatedAt,
  };
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
    ...toIdentityFields(definition, updatedAt),
  });
  await insertContentRows(ctx, customAgentId, definition);
}

/**
 * Patches the identity row and rewrites both body tables. Used for content
 * changes and for rules-version rewrites, never for a disabled-only toggle.
 */
async function patchAgent(
  ctx: MutationCtx,
  existing: Doc<'chatroom_customAgents'>,
  definition: CustomAgentDefinitionPayload,
  updatedAt: number
): Promise<void> {
  await ctx.db.patch(
    'chatroom_customAgents',
    existing._id,
    toIdentityFields(definition, updatedAt)
  );
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

/** True when the stored row predates the current rules and must be fully rewritten. */
function isDefinitionChanged(
  current: Doc<'chatroom_customAgents'>,
  definition: CustomAgentDefinitionPayload,
  forceRewrite: boolean
): boolean {
  return forceRewrite || current.contentHash !== definition.contentHash;
}

/**
 * Applies one accepted definition: insert when new, rewrite both body tables
 * when the content or rules changed, or patch the disabled flag in place so the
 * content and template rows keep their ids.
 */
async function applyAcceptedAgent(
  ctx: MutationCtx,
  key: SourceKey,
  sourceId: Id<'chatroom_customAgentSources'>,
  definition: CustomAgentDefinitionPayload,
  current: Doc<'chatroom_customAgents'> | undefined,
  updatedAt: number,
  forceRewrite: boolean
): Promise<void> {
  if (current === undefined) {
    await insertAgent(ctx, key, sourceId, definition, updatedAt);
    return;
  }
  if (isDefinitionChanged(current, definition, forceRewrite)) {
    await patchAgent(ctx, current, definition, updatedAt);
    return;
  }
  if (current.disabled !== definition.disabled) {
    await ctx.db.patch('chatroom_customAgents', current._id, {
      disabled: definition.disabled,
      updatedAt,
    });
  }
}

async function applyAcceptedAgents(
  ctx: MutationCtx,
  key: SourceKey,
  sourceId: Id<'chatroom_customAgentSources'>,
  accepted: readonly CustomAgentDefinitionPayload[],
  existingByName: ReadonlyMap<string, Doc<'chatroom_customAgents'>>,
  updatedAt: number,
  forceRewrite: boolean
): Promise<void> {
  for (const definition of accepted) {
    await applyAcceptedAgent(
      ctx,
      key,
      sourceId,
      definition,
      existingByName.get(definition.name),
      updatedAt,
      forceRewrite
    );
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
  updatedAt: number,
  forceRewrite: boolean
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_customAgents')
    .withIndex('by_source', (q) => q.eq('sourceId', sourceId))
    .collect();
  const existingByName = new Map(existing.map((agent) => [agent.name, agent]));
  const acceptedNames = new Set(accepted.map((agent) => agent.name));

  await deleteMissingAgents(ctx, existing, acceptedNames);
  await applyAcceptedAgents(ctx, key, sourceId, accepted, existingByName, updatedAt, forceRewrite);
}

/**
 * Reconciles machine-local disable flags when the source snapshot itself is
 * unchanged.
 *
 * The pushed source hash covers authored content, not the disable flags, so a
 * toggle arrives with the same source hash. Only rows whose `disabled` differs
 * are patched: prompts and templates keep their ids and are never rewritten on
 * this path. Returns true when at least one row changed.
 */
async function reconcileDisabledFlags(
  ctx: MutationCtx,
  sourceId: Id<'chatroom_customAgentSources'>,
  accepted: readonly CustomAgentDefinitionPayload[],
  updatedAt: number
): Promise<boolean> {
  const rows = await ctx.db
    .query('chatroom_customAgents')
    .withIndex('by_source', (q) => q.eq('sourceId', sourceId))
    .collect();
  const rowByName = new Map(rows.map((row) => [row.name, row]));
  let applied = false;

  for (const definition of accepted) {
    const row = rowByName.get(definition.name);
    if (row === undefined || row.disabled === definition.disabled) continue;
    await ctx.db.patch('chatroom_customAgents', row._id, {
      disabled: definition.disabled,
      updatedAt,
    });
    applied = true;
  }

  return applied;
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
  if (existing.rulesVersion !== CUSTOM_AGENT_RULES_VERSION) return false;
  if (existing.contentHash !== contentHash) return false;
  return canonicalizeIssues(existing.issues).json === issuesJson;
}

/**
 * An identical content hash means only the reported issues changed — unless the
 * stored snapshot predates the current validation rules, in which case the
 * agents must be revalidated and rewritten.
 */
function needsAgentReconcile(
  existing: Doc<'chatroom_customAgentSources'> | null,
  contentHash: string
): boolean {
  return (
    existing === null ||
    existing.contentHash !== contentHash ||
    existing.rulesVersion !== CUSTOM_AGENT_RULES_VERSION
  );
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
    rulesVersion: CUSTOM_AGENT_RULES_VERSION,
    agentCount: input.accepted.length,
    issues: input.issues,
    updatedAt: now,
  });
  if (needsAgentReconcile(existing, input.contentHash)) {
    const forceRewrite = existing !== null && existing.rulesVersion !== CUSTOM_AGENT_RULES_VERSION;
    await reconcileAgents(ctx, key, sourceId, input.accepted, now, forceRewrite);
  }
}

export async function syncCustomAgentDefinitions(
  ctx: MutationCtx,
  input: SyncCustomAgentDefinitionsInput
): Promise<SyncCustomAgentDefinitionsResult> {
  assertScopeMatchesWorkingDir(input);
  const normalized = normalizeScopeWorkingDir(input);
  assertWithinLimits(normalized);

  const validated = partitionAgents(normalized.agents);
  const canonical = canonicalizeIssues(mergePushedIssues(normalized.issues, validated.issues));
  const key = toSourceKey(normalized);
  const existingSource = await findSource(ctx, key);
  if (
    existingSource !== null &&
    isUnchangedSnapshot(existingSource, normalized.contentHash, canonical.json)
  ) {
    const applied = await reconcileDisabledFlags(
      ctx,
      existingSource._id,
      validated.accepted,
      Date.now()
    );
    return { applied, rejected: validated.rejected };
  }

  await writeSnapshot(ctx, key, existingSource, {
    contentHash: normalized.contentHash,
    accepted: validated.accepted,
    issues: canonical.issues,
  });
  return { applied: true, rejected: validated.rejected };
}
