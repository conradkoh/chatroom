import {
  AGENT_ROLE_DEFINITIONS,
  AgentRoleLifecycleTag,
  isBuiltinAgentRole,
  isRetiredAgentRole,
} from './agent-role';
import type { TeamStructure, TeamStructureRole } from './team-presets';

/**
 * Custom agents are user-authored roles that live beside the builtin catalog.
 * This module is the single source for their limits, name rules, issue reasons,
 * sanitization, and the pure team merge. It contains no file IO and no Node
 * APIs so CLI, backend, and webapp consumers share one set of rules.
 */

/** Lowercase kebab-case names only. */
export const CUSTOM_AGENT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const CUSTOM_AGENT_LIMITS = {
  nameMaxLength: 48,
  descriptionMaxLength: 200,
  systemPromptMaxBytes: 24 * 1024,
  handoffTemplateMaxBytes: 4 * 1024,
  agentsPerSource: 12,
  agentsPerChatroom: 16,
  issuesPerSource: 50,
} as const;

/**
 * Max characters stored for an issue `path` or `detail`. A rejected name or a
 * filesystem error message is otherwise unbounded and would bloat every source
 * snapshot that records it.
 */
export const CUSTOM_AGENT_ISSUE_TEXT_LIMIT = 256;

export const CUSTOM_AGENT_SCOPES = ['workspace', 'machine'] as const;
export type CustomAgentScope = (typeof CUSTOM_AGENT_SCOPES)[number];

/**
 * Teams that support custom agents. Only duo does: the prompt composer treats
 * any multi-member team as duo, so merging customs into solo would corrupt
 * solo prompts.
 */
export const CUSTOM_AGENT_SUPPORTED_TEAM_IDS = ['duo'] as const;

/** True when the team supports custom agents. Tolerates case and whitespace. */
export function supportsCustomAgents(teamId: string): boolean {
  return CUSTOM_AGENT_SUPPORTED_TEAM_IDS.includes(
    teamId.trim().toLowerCase() as (typeof CUSTOM_AGENT_SUPPORTED_TEAM_IDS)[number]
  );
}

/** Frontmatter keys that would otherwise smuggle model or harness selection into a role. */
export const CUSTOM_AGENT_FORBIDDEN_FRONTMATTER_KEYS = [
  'model',
  'models',
  'harness',
  'harnesses',
  'agentHarness',
  'agent-harness',
  'agent_harness',
  'provider',
] as const;

export const CUSTOM_AGENT_ISSUE_REASONS = [
  'missing-frontmatter',
  'invalid-frontmatter',
  'invalid-name',
  'name-mismatch',
  'reserved-name',
  'invalid-description',
  'forbidden-field',
  'unknown-field',
  'too-large',
  'reserved-delimiter',
  'unreadable',
  'root-truncated',
  'gitignored',
  'shadowed',
  'over-limit',
] as const;
export type CustomAgentIssueReason = (typeof CUSTOM_AGENT_ISSUE_REASONS)[number];

export interface CustomAgentIssue {
  path: string;
  reason: CustomAgentIssueReason;
  detail?: string;
}

export interface CustomAgentDefinitionPayload {
  name: string;
  description: string;
  systemPrompt: string;
  inboundHandoffTemplate?: string;
  returnHandoffTemplate?: string;
  /** Per-agent content hash the client computes over [name, description, systemPrompt, inbound ?? null, return ?? null]. Excludes `disabled`. */
  contentHash: string;
  /** Machine-local disable flag stamped by the daemon. */
  disabled: boolean;
}

export interface CustomAgentIdentity {
  name: string;
  description: string;
  scope: CustomAgentScope;
}

export interface TeamRosterEntry {
  role: string;
  lifecycle: AgentRoleLifecycleTag;
  source: 'builtin' | 'custom';
  summary: string;
  disabled: boolean;
  disableable: boolean;
  scope?: CustomAgentScope;
}

export interface MergedTeam {
  structure: TeamStructure;
  roster: TeamRosterEntry[];
  enabledCustomAgents: CustomAgentIdentity[];
  issues: CustomAgentIssue[];
}

/** Block tags whose opening delimiter would otherwise be read as chatroom XML. */
const RESERVED_BLOCK_TAGS = [
  'task',
  'task-intake',
  'message',
  'message-content',
  'instruction',
  'next-steps',
  'handoffs',
  'handoff-templates',
  'chat-mode',
  'team-roster',
  'custom-agent-instructions',
  'attachments',
  'system-reminder',
] as const;

/** Delimiters that terminate a handoff payload; a body line equal to one would truncate it. */
export const RESERVED_DELIMITER_LINES = ['CHATROOM_HANDOFF_END', 'CHATROOM_NOTIFY_END'] as const;

export const CUSTOM_AGENT_RULES_REVISION = 1;

/** FNV-1a 32-bit over UTF-16 code units. Pure, deterministic, no Node APIs. */
function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Per-agent content hash over the stored definition fields, positionally
 * serialized so key order is irrelevant. Excludes `disabled`, so a
 * machine-local toggle never looks like a content change. The server recomputes
 * this value instead of trusting the pushed one, so a stale or hostile client
 * hash cannot suppress a content update.
 */
export function computeCustomAgentContentHash(
  definition: Omit<CustomAgentDefinitionPayload, 'contentHash' | 'disabled'>
): string {
  return fnv1a32Hex(
    JSON.stringify([
      definition.name,
      definition.description,
      definition.systemPrompt,
      definition.inboundHandoffTemplate ?? null,
      definition.returnHandoffTemplate ?? null,
    ])
  );
}

/**
 * The inputs the rules fingerprint is computed from. Every field changes the
 * fingerprint when it changes, so a test can vary one input at a time.
 */
export interface CustomAgentRulesVersionInput {
  readonly revision: number;
  readonly limits: typeof CUSTOM_AGENT_LIMITS;
  readonly forbiddenFrontmatterKeys: readonly string[];
  readonly builtinRoleNames: readonly string[];
  readonly reservedDelimiterLines: readonly string[];
}

/** Pure fingerprint of the validation rules. Input order and JSON shape must stay as-is. */
export function computeCustomAgentRulesVersion(input: CustomAgentRulesVersionInput): string {
  return `r${input.revision}-${fnv1a32Hex(
    JSON.stringify([
      input.revision,
      input.limits,
      input.forbiddenFrontmatterKeys,
      [...input.builtinRoleNames].sort(),
      'user',
      'enhancer',
      input.reservedDelimiterLines,
    ])
  )}`;
}

/**
 * Bump CUSTOM_AGENT_RULES_REVISION manually when validation semantics change in a way
 * these inputs do not capture. Stored on each source row; a mismatch forces revalidation
 * and a full rewrite (m5).
 */
export const CUSTOM_AGENT_RULES_VERSION = computeCustomAgentRulesVersion({
  revision: CUSTOM_AGENT_RULES_REVISION,
  limits: CUSTOM_AGENT_LIMITS,
  forbiddenFrontmatterKeys: CUSTOM_AGENT_FORBIDDEN_FRONTMATTER_KEYS,
  builtinRoleNames: Object.keys(AGENT_ROLE_DEFINITIONS),
  reservedDelimiterLines: RESERVED_DELIMITER_LINES,
});

const textEncoder = new TextEncoder();

function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).length;
}

function hasReservedDelimiterLine(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) =>
      RESERVED_DELIMITER_LINES.some((reservedDelimiter) => line === reservedDelimiter)
    );
}

/** null when valid. 'reserved-name' when isBuiltinAgentRole(name) || name === 'user' || isRetiredAgentRole(name). */
export function validateCustomAgentName(name: string): 'invalid-name' | 'reserved-name' | null {
  if (!isWellFormedCustomAgentName(name)) return 'invalid-name';
  return isReservedCustomAgentName(name) ? 'reserved-name' : null;
}

function isWellFormedCustomAgentName(name: string): boolean {
  return name.length <= CUSTOM_AGENT_LIMITS.nameMaxLength && CUSTOM_AGENT_NAME_PATTERN.test(name);
}

function isReservedCustomAgentName(name: string): boolean {
  return isBuiltinAgentRole(name) || name === 'user' || isRetiredAgentRole(name);
}

/**
 * Reduces authored metadata to one display line: control characters and
 * newlines become spaces, the markup characters `<`, `>`, and backticks are
 * dropped, whitespace collapses, and the result is truncated to the
 * description limit.
 */
export function sanitizeCustomAgentSummary(text: string): string {
  return text
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/[<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CUSTOM_AGENT_LIMITS.descriptionMaxLength);
}

/**
 * Escapes opening delimiters of reserved chatroom blocks while leaving
 * non-reserved tags untouched, so authored text cannot impersonate protocol
 * markup. Case-insensitive on the tag name.
 *
 * Not yet applied to stored systemPrompt or template bodies. Prompt composition
 * must call this before rendering them.
 */
export function neutralizeChatroomBlockTags(text: string): string {
  const reservedTagAlternation = RESERVED_BLOCK_TAGS.join('|');
  const reservedOpeningDelimiter = new RegExp(
    `<(?=\\/?(?:${reservedTagAlternation})(?![\\w-]))`,
    'gi'
  );
  return text.replace(reservedOpeningDelimiter, '&lt;');
}

/**
 * Validates a definition payload before it is stored or rendered. Checks the
 * name first, then the size caps (UTF-8 bytes), then whether any body contains
 * a reserved handoff delimiter line.
 */
export function validateCustomAgentPayload(
  payload: CustomAgentDefinitionPayload
): { ok: true } | { ok: false; reason: CustomAgentIssueReason; detail?: string } {
  const nameIssue = validateCustomAgentName(payload.name);
  if (nameIssue !== null) {
    return { ok: false, reason: nameIssue };
  }
  if (sanitizeCustomAgentSummary(payload.description).length === 0) {
    return { ok: false, reason: 'invalid-description' };
  }
  return validateCustomAgentBodies(payload);
}

function validateCustomAgentBodies(
  payload: CustomAgentDefinitionPayload
): { ok: true } | { ok: false; reason: CustomAgentIssueReason; detail?: string } {
  const oversizedBody = findOversizedBody(payload);
  if (oversizedBody !== null) {
    return { ok: false, reason: 'too-large', detail: oversizedBody };
  }
  if (hasReservedDelimiterBody(payload)) {
    return { ok: false, reason: 'reserved-delimiter' };
  }
  return { ok: true };
}

/** Returns the name of the first body over its byte cap, if any. */
function findOversizedBody(payload: CustomAgentDefinitionPayload): string | null {
  const bodies: readonly [name: string, body: string | undefined, maxBytes: number][] = [
    ['systemPrompt', payload.systemPrompt, CUSTOM_AGENT_LIMITS.systemPromptMaxBytes],
    [
      'inboundHandoffTemplate',
      payload.inboundHandoffTemplate,
      CUSTOM_AGENT_LIMITS.handoffTemplateMaxBytes,
    ],
    [
      'returnHandoffTemplate',
      payload.returnHandoffTemplate,
      CUSTOM_AGENT_LIMITS.handoffTemplateMaxBytes,
    ],
  ];
  const oversized = bodies.find(
    ([, body, maxBytes]) => body !== undefined && utf8ByteLength(body) > maxBytes
  );
  return oversized ? oversized[0] : null;
}

function hasReservedDelimiterBody(payload: CustomAgentDefinitionPayload): boolean {
  return [payload.systemPrompt, payload.inboundHandoffTemplate, payload.returnHandoffTemplate].some(
    (body) => body !== undefined && hasReservedDelimiterLine(body)
  );
}

/**
 * Only ephemeral, non-builtin, non-entry-point roles are disableable. Builtins
 * are never disableable, even when they are ephemeral.
 */
export function isDisableableTeamRole(structure: TeamStructure, role: string): boolean {
  if (isBuiltinAgentRole(role) || role === structure.entryPoint) return false;
  const entry = structure.roles.find((candidate) => candidate.role === role);
  return entry?.lifecycle === AgentRoleLifecycleTag.Ephemeral;
}

function byName(left: { name: string }, right: { name: string }): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

/**
 * Workspace agents come first so they win every name clash; later duplicates
 * are shadowed. Invalid and reserved names are dropped with an issue. Each
 * source is sorted by name so the downstream cap is deterministic without
 * re-sorting across scopes.
 */
function resolveCustomAgentCandidates(
  workspaceAgents: readonly CustomAgentIdentity[],
  machineAgents: readonly CustomAgentIdentity[]
): { candidates: CustomAgentIdentity[]; issues: CustomAgentIssue[] } {
  const issues: CustomAgentIssue[] = [];
  const candidates: CustomAgentIdentity[] = [];
  const seenNames = new Set<string>();
  const sortedWorkspace = [...workspaceAgents].sort(byName);
  const sortedMachine = [...machineAgents].sort(byName);

  for (const agent of [...sortedWorkspace, ...sortedMachine]) {
    const nameIssue = validateCustomAgentName(agent.name);
    if (nameIssue !== null) {
      issues.push({ path: agent.name, reason: nameIssue });
      continue;
    }
    if (seenNames.has(agent.name)) {
      issues.push({ path: agent.name, reason: 'shadowed' });
      continue;
    }
    seenNames.add(agent.name);
    candidates.push(agent);
  }

  return { candidates, issues };
}

/** Keeps the first agentsPerChatroom candidates in input order (workspace, then machine); reports the rest. */
function capCustomAgentCandidates(candidates: readonly CustomAgentIdentity[]): {
  enabled: CustomAgentIdentity[];
  issues: CustomAgentIssue[];
} {
  return {
    enabled: candidates.slice(0, CUSTOM_AGENT_LIMITS.agentsPerChatroom),
    issues: candidates
      .slice(CUSTOM_AGENT_LIMITS.agentsPerChatroom)
      .map((agent) => ({ path: agent.name, reason: 'over-limit' as const })),
  };
}

/** Appends customs as optional ephemeral roles. Names are already validated as non-builtin. */
function appendCustomRoles(
  baseRoles: readonly TeamStructureRole[],
  agents: readonly CustomAgentIdentity[]
): TeamStructureRole[] {
  return [
    ...baseRoles,
    ...agents.map((agent) => ({
      role: agent.name,
      lifecycle: AgentRoleLifecycleTag.Ephemeral,
      optional: true,
    })),
  ];
}

/** Roster entries for disabled customs, which are not present in `structure.roles`. */
function buildDisabledCustomRoster(agents: readonly CustomAgentIdentity[]): TeamRosterEntry[] {
  return agents.map((agent) => ({
    role: agent.name,
    lifecycle: AgentRoleLifecycleTag.Ephemeral,
    source: 'custom',
    summary: sanitizeCustomAgentSummary(agent.description),
    disabled: true,
    disableable: true,
    scope: agent.scope,
  }));
}

function buildRoster(
  structure: TeamStructure,
  agents: readonly CustomAgentIdentity[]
): TeamRosterEntry[] {
  const customByName = new Map(agents.map((agent) => [agent.name, agent]));
  return structure.roles.map((entry) => {
    const disableable = isDisableableTeamRole(structure, entry.role);
    if (isBuiltinAgentRole(entry.role)) {
      return {
        role: entry.role,
        lifecycle: entry.lifecycle,
        source: 'builtin',
        summary: AGENT_ROLE_DEFINITIONS[entry.role].summary,
        disabled: false,
        disableable,
      };
    }
    const customAgent = customByName.get(entry.role);
    return {
      role: entry.role,
      lifecycle: entry.lifecycle,
      source: 'custom',
      summary: customAgent ? sanitizeCustomAgentSummary(customAgent.description) : '',
      disabled: false,
      disableable,
      ...(customAgent ? { scope: customAgent.scope } : {}),
    };
  });
}

/**
 * Merges custom agent identities into a resolved team structure.
 *
 * Workspace agents win name clashes against machine agents. Reserved or
 * invalid names are dropped with an issue and duplicate names shadow. Custom
 * agents listed in `disabledRoles` are removed before the cap, so they never
 * consume a slot; they remain in the roster with `disabled: true`. The
 * remaining customs keep scope order — workspace sorted by name, then machine
 * sorted by name — and are capped at the per-chatroom limit. Only custom names
 * are disableable: builtins and the entry point never are. With no customs and
 * no disabled roles, the resulting structure deep-equals the base.
 */
export function mergeTeamStructureWithCustomAgents(input: {
  base: TeamStructure;
  workspaceAgents: readonly CustomAgentIdentity[];
  machineAgents: readonly CustomAgentIdentity[];
  disabledRoles: ReadonlySet<string>;
}): MergedTeam {
  const resolved = resolveCustomAgentCandidates(input.workspaceAgents, input.machineAgents);
  // Disabled customs are removed before the cap, so they never consume a slot.
  const disabledCandidates = resolved.candidates.filter((agent) =>
    input.disabledRoles.has(agent.name)
  );
  const enabledCandidates = resolved.candidates.filter(
    (agent) => !input.disabledRoles.has(agent.name)
  );
  const capped = capCustomAgentCandidates(enabledCandidates);

  const structure: TeamStructure = {
    ...input.base,
    roles: appendCustomRoles(input.base.roles, capped.enabled),
  };
  const enabledRoster = buildRoster(structure, capped.enabled);
  const disabledRoster = buildDisabledCustomRoster(disabledCandidates);

  return {
    structure,
    roster: [...enabledRoster, ...disabledRoster],
    enabledCustomAgents: capped.enabled,
    issues: [...resolved.issues, ...capped.issues],
  };
}
