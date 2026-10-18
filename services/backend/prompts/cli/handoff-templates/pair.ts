/**
 * Pair-key primitives for handoff templates.
 *
 * Handoff templates are addressed by the (sender, recipient) pair, not by a
 * single role. This module owns the pure pair vocabulary — the pair key type,
 * id/label/command formatting, the team-preset guard, the pair error class,
 * and the exact error-message builders.
 *
 * It deliberately imports nothing from the team catalogs or `./index` so the
 * catalogs can depend on it without creating an import cycle.
 */

import { TEAM_PRESET_IDS, type TeamPresetId } from '@workspace/shared/domain/team-kind';

/** One addressed handoff template: a sender and recipient within a team. */
export interface HandoffTemplatePair {
  teamId: TeamPresetId;
  fromRole: string;
  toRole: string;
}

/** Stable pair key, e.g. `duo:planner->builder`. */
export type HandoffTemplatePairId = `${TeamPresetId}:${string}->${string}`;

/** Handoff CLI commands that address a template by pair. */
export type HandoffTemplateCommandName = 'view-template' | 'list-templates';

/** Raw pair input, including the deprecated parent-group role flags. */
export interface HandoffTemplatePairInput {
  from?: string | undefined;
  to?: string | undefined;
  teamId?: string | undefined;
  /** Deprecated parent-group `--role`. */
  legacyRole?: string | undefined;
  /** Deprecated parent-group `--next-role`. */
  legacyNextRole?: string | undefined;
}

export type HandoffTemplatePairErrorCode =
  'MISSING_PAIR' | 'LEGACY_ROLE_FLAGS' | 'UNKNOWN_TEAM' | 'UNKNOWN_FROM_ROLE' | 'UNKNOWN_PAIR';

export class HandoffTemplatePairError extends Error {
  constructor(
    readonly code: HandoffTemplatePairErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'HandoffTemplatePairError';
  }
}

/** Trims and lowercases a role token; an empty/whitespace token becomes `undefined`. */
export function normalizeHandoffRole(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

/** Type guard for the builtin team presets (`duo`, `solo`). */
export function isTeamPresetId(value: string): value is TeamPresetId {
  return (TEAM_PRESET_IDS as readonly string[]).includes(value);
}

/** Stable id for a pair, e.g. `duo:planner->builder`. */
// fallow-ignore-next-line unused-export
export function formatHandoffTemplatePairId(
  pair: Pick<HandoffTemplatePair, 'teamId' | 'fromRole' | 'toRole'>
): HandoffTemplatePairId {
  return `${pair.teamId}:${pair.fromRole}->${pair.toRole}`;
}

/** Human-readable pair label, e.g. `` `planner` → `builder` ``. */
// fallow-ignore-next-line unused-export
export function formatHandoffPairLabel(pair: { fromRole: string; toRole: string }): string {
  return `\`${pair.fromRole}\` → \`${pair.toRole}\``;
}

/** Copy/paste-ready command that addresses a pair. */
// fallow-ignore-next-line unused-export
export function formatHandoffTemplateCommand(
  command: HandoffTemplateCommandName,
  pair: HandoffTemplatePair,
  cliEnvPrefix = ''
): string {
  return `${cliEnvPrefix}chatroom handoff ${command} --from="${pair.fromRole}" --to="${pair.toRole}" --team-id="${pair.teamId}"`;
}

type MissingFlags = '--from, --to' | '--from' | '--to';

/** `MISSING_PAIR` message: both `--from`/`--to` are required. */
export function missingPairMessage(
  command: HandoffTemplateCommandName,
  missing: MissingFlags
): string {
  return [
    `handoff ${command} requires both --from and --to (missing: ${missing}). Handoff templates are keyed by the (sender, recipient) pair.`,
    `Example: chatroom handoff ${command} --from="planner" --to="builder" --team-id="duo"`,
  ].join('\n');
}

export interface LegacyRoleFlagsMessageInput {
  teamId: string;
  legacyRole?: string | undefined;
  legacyNextRole?: string | undefined;
  /** Pairs from `legacyRole` when it names a catalog role; empty/undefined otherwise. */
  rolePairs?: readonly HandoffTemplatePair[] | undefined;
}

/** `LEGACY_ROLE_FLAGS` message: `--role`/`--next-role` are keyed by pair now. */
// fallow-ignore-next-line complexity
export function legacyRoleFlagsMessage(
  command: HandoffTemplateCommandName,
  input: LegacyRoleFlagsMessageInput
): string {
  const header = `handoff ${command} no longer accepts --role/--next-role. Handoff templates are keyed by the (sender, recipient) pair.`;

  if (input.legacyRole !== undefined && input.legacyNextRole !== undefined) {
    return [
      header,
      `Use: ${formatHandoffTemplateCommand(command, {
        teamId: input.teamId as TeamPresetId,
        fromRole: input.legacyRole,
        toRole: input.legacyNextRole,
      })}`,
    ].join('\n');
  }

  if (input.legacyRole !== undefined && input.rolePairs && input.rolePairs.length > 0) {
    return [
      header,
      `Pairs from "${input.legacyRole}" in team "${input.teamId}":`,
      ...input.rolePairs.map((pair) => `  ${formatHandoffTemplateCommand(command, pair)}`),
    ].join('\n');
  }

  const to = input.legacyNextRole ?? '<recipient-role>';
  return [
    header,
    `Use: chatroom handoff ${command} --from="<your-role>" --to="${to}" --team-id="${input.teamId}"`,
  ].join('\n');
}

/** `UNKNOWN_TEAM` message. */
export function unknownTeamMessage(team: string): string {
  return `Unknown team "${team}". Known teams: ${TEAM_PRESET_IDS.join(', ')}.`;
}

/** `UNKNOWN_FROM_ROLE` message. */
export function unknownFromRoleMessage(input: {
  from: string;
  team: string;
  roles: readonly string[];
}): string {
  return `Role "${input.from}" has no handoff templates in team "${input.team}". Roles with handoff templates: ${input.roles.join(', ')}.`;
}

/** `UNKNOWN_PAIR` message. */
export function unknownPairMessage(input: {
  from: string;
  to: string;
  team: string;
  recipients: readonly string[];
}): string {
  return `No handoff template for "${input.from}" → "${input.to}" in team "${input.team}". Valid recipients for "${input.from}": ${input.recipients.join(', ')}.`;
}

/**
 * `UNKNOWN_PAIR` message for a pair that the catalog validates but whose
 * getter returned no template. Shared by the pair commands so both report the
 * same wording.
 */
export function unrenderablePairMessage(pair: HandoffTemplatePair): string {
  return `No handoff template for "${pair.fromRole}" → "${pair.toRole}" in team "${pair.teamId}".`;
}
