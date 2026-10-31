// fallow-ignore-file unused-file
// Introduced ahead of its consumers: the custom-agent CLI, backend, and webapp
// slices import this module. Remove this suppression when the first consumer lands.
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

export const CUSTOM_AGENT_SCOPES = ['workspace', 'machine'] as const;
export type CustomAgentScope = (typeof CUSTOM_AGENT_SCOPES)[number];

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
  contentHash: string;
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
const RESERVED_DELIMITER_LINES = ['CHATROOM_HANDOFF_END', 'CHATROOM_NOTIFY_END'] as const;

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
 * True only when the role is ephemeral in the structure and is not the entry
 * point. Permanent roles are never disableable.
 */
export function isDisableableTeamRole(structure: TeamStructure, role: string): boolean {
  if (role === structure.entryPoint) return false;
  const entry = structure.roles.find((candidate) => candidate.role === role);
  return entry?.lifecycle === AgentRoleLifecycleTag.Ephemeral;
}

function byName(left: { name: string }, right: { name: string }): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

/**
 * Workspace agents come first so they win every name clash; later duplicates
 * are shadowed. Invalid and reserved names are dropped with an issue.
 */
function resolveCustomAgentCandidates(
  workspaceAgents: readonly CustomAgentIdentity[],
  machineAgents: readonly CustomAgentIdentity[]
): { candidates: CustomAgentIdentity[]; issues: CustomAgentIssue[] } {
  const issues: CustomAgentIssue[] = [];
  const candidates: CustomAgentIdentity[] = [];
  const seenNames = new Set<string>();

  for (const agent of [...workspaceAgents, ...machineAgents]) {
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

/** Sorts by name and keeps at most the per-chatroom limit, reporting every extra. */
function capCustomAgentCandidates(candidates: readonly CustomAgentIdentity[]): {
  enabled: CustomAgentIdentity[];
  issues: CustomAgentIssue[];
} {
  const sorted = [...candidates].sort(byName);
  return {
    enabled: sorted.slice(0, CUSTOM_AGENT_LIMITS.agentsPerChatroom),
    issues: sorted
      .slice(CUSTOM_AGENT_LIMITS.agentsPerChatroom)
      .map((agent) => ({ path: agent.name, reason: 'over-limit' as const })),
  };
}

/** Appends customs that the base structure does not already declare. */
function appendCustomRoles(
  baseRoles: readonly TeamStructureRole[],
  agents: readonly CustomAgentIdentity[]
): TeamStructureRole[] {
  const customRoles = agents
    .filter((agent) => !baseRoles.some((entry) => entry.role === agent.name))
    .map((agent) => ({
      role: agent.name,
      lifecycle: AgentRoleLifecycleTag.Ephemeral,
      optional: true,
    }));
  return customRoles.length === 0 ? [...baseRoles] : [...baseRoles, ...customRoles];
}

/** Every disabled role that is actually disableable in the combined structure. */
function resolveDisabledRoleNames(
  structure: TeamStructure,
  disabledRoles: ReadonlySet<string>
): ReadonlySet<string> {
  return new Set(
    structure.roles
      .filter(
        (entry) => disabledRoles.has(entry.role) && isDisableableTeamRole(structure, entry.role)
      )
      .map((entry) => entry.role)
  );
}

function buildRoster(
  structure: TeamStructure,
  agents: readonly CustomAgentIdentity[],
  disabledRoleNames: ReadonlySet<string>
): TeamRosterEntry[] {
  const customByName = new Map(agents.map((agent) => [agent.name, agent]));
  return structure.roles.map((entry) => {
    const disabled = disabledRoleNames.has(entry.role);
    const disableable = isDisableableTeamRole(structure, entry.role);
    if (isBuiltinAgentRole(entry.role)) {
      return {
        role: entry.role,
        lifecycle: entry.lifecycle,
        source: 'builtin',
        summary: AGENT_ROLE_DEFINITIONS[entry.role].summary,
        disabled,
        disableable,
      };
    }
    const customAgent = customByName.get(entry.role);
    return {
      role: entry.role,
      lifecycle: entry.lifecycle,
      source: 'custom',
      summary: customAgent ? sanitizeCustomAgentSummary(customAgent.description) : '',
      disabled,
      disableable,
      ...(customAgent ? { scope: customAgent.scope } : {}),
    };
  });
}

/**
 * Merges custom agent identities into a resolved team structure.
 *
 * Workspace agents win name clashes against machine agents. Reserved or
 * invalid names are dropped with an issue, duplicate names shadow, and the
 * surviving customs are sorted by name and capped at the per-chatroom limit.
 * Surviving customs are appended as optional ephemeral roles. Disableable
 * roles listed in `disabledRoles` are removed from `structure.roles` while
 * remaining in the roster with `disabled: true`. With no customs and no
 * disabled roles, the resulting structure deep-equals the base.
 */
export function mergeTeamStructureWithCustomAgents(input: {
  base: TeamStructure;
  workspaceAgents: readonly CustomAgentIdentity[];
  machineAgents: readonly CustomAgentIdentity[];
  disabledRoles: ReadonlySet<string>;
}): MergedTeam {
  const resolved = resolveCustomAgentCandidates(input.workspaceAgents, input.machineAgents);
  const capped = capCustomAgentCandidates(resolved.candidates);
  const combinedRoles = appendCustomRoles(input.base.roles, capped.enabled);
  const combinedStructure: TeamStructure = { ...input.base, roles: combinedRoles };
  const disabledRoleNames = resolveDisabledRoleNames(combinedStructure, input.disabledRoles);
  const keptRoles =
    disabledRoleNames.size === 0
      ? combinedRoles
      : combinedRoles.filter((entry) => !disabledRoleNames.has(entry.role));

  return {
    structure: { ...input.base, roles: keptRoles },
    roster: buildRoster(combinedStructure, capped.enabled, disabledRoleNames),
    enabledCustomAgents: capped.enabled,
    issues: [...resolved.issues, ...capped.issues],
  };
}

/**
 * Splits team roles into lifecycle buckets for the webapp. Retired roles and
 * `user` are never selectable agents.
 */
export function partitionTeamRolesByLifecycle(roles: readonly TeamStructureRole[]): {
  permanent: string[];
  ephemeral: string[];
} {
  const selectable = roles.filter(
    (entry) => entry.role !== 'user' && !isRetiredAgentRole(entry.role)
  );
  return {
    permanent: selectable
      .filter((entry) => entry.lifecycle === AgentRoleLifecycleTag.Permanent)
      .map((entry) => entry.role),
    ephemeral: selectable
      .filter((entry) => entry.lifecycle === AgentRoleLifecycleTag.Ephemeral)
      .map((entry) => entry.role),
  };
}
