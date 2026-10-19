/**
 * Pair-key primitives for handoff templates.
 *
 * Handoff templates are addressed by the (sender, recipient) pair, not by a
 * single role. This module owns the pure pair vocabulary — the pair key type,
 * label/command formatting, the team-preset guard, the pair error class,
 * and the exact error-message builders.
 *
 * It deliberately imports nothing from the team catalogs or `./index` so the
 * catalogs can depend on it without creating an import cycle.
 */

import {
  CONVERSATION_MODES,
  type ConversationMode,
} from '@workspace/shared/domain/conversation-mode';
import { TEAM_PRESET_IDS, type TeamPresetId } from '@workspace/shared/domain/team-kind';

/** One addressed handoff template: a sender and recipient within a team. */
export interface HandoffTemplatePair {
  teamId: TeamPresetId;
  fromRole: string;
  toRole: string;
}

/** Handoff CLI commands that address a template by pair. */
export type HandoffTemplateCommandName = 'view-template' | 'list-templates';

/** Raw pair input, including the deprecated parent-group role flags. */
export interface HandoffTemplatePairInput {
  from?: string | undefined;
  to?: string | undefined;
  /** Conversation mode: `chat` | `code` | `code:enhanced`. Required by view-template and list-templates. */
  mode?: string | undefined;
  teamId?: string | undefined;
  /** Deprecated parent-group `--role`. */
  legacyRole?: string | undefined;
  /** Deprecated parent-group `--next-role`. */
  legacyNextRole?: string | undefined;
}

export type HandoffTemplatePairErrorCode =
  | 'MISSING_PAIR'
  | 'MISSING_MODE'
  | 'UNKNOWN_MODE'
  | 'LEGACY_ROLE_FLAGS'
  | 'UNKNOWN_TEAM'
  | 'UNKNOWN_FROM_ROLE'
  | 'UNKNOWN_PAIR';

/** Key segment for a template body: `chat`, or `code` (covers `code` and `code:enhanced`). */
export type HandoffTemplateModeBucket = 'chat' | 'code';

/** A pair plus the conversation mode it is rendered for. */
export interface HandoffTemplateSelection {
  pair: HandoffTemplatePair;
  mode: ConversationMode;
}

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

/** Trims and lowercases a mode token; empty/whitespace becomes `undefined`. */
export function normalizeHandoffMode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

/** Type guard for the canonical conversation modes. */
export function isConversationMode(value: string): value is ConversationMode {
  return (CONVERSATION_MODES as readonly string[]).includes(value);
}

/** Body bucket for a mode: `chat` alone, otherwise the shared `code` body. */
function modeBucket(mode: ConversationMode): HandoffTemplateModeBucket {
  return mode === 'chat' ? 'chat' : 'code';
}

/** Stable key for a selection, e.g. `duo:planner->user@chat`. */
export function formatHandoffTemplateKey(selection: HandoffTemplateSelection): string {
  const { pair, mode } = selection;
  return `${pair.teamId}:${pair.fromRole}->${pair.toRole}@${modeBucket(mode)}`;
}

/** Type guard for the builtin team presets (`duo`, `solo`). */
export function isTeamPresetId(value: string): value is TeamPresetId {
  return (TEAM_PRESET_IDS as readonly string[]).includes(value);
}

/** Builtin team used when a caller omits a team id; the single source of the default. */
export const DEFAULT_HANDOFF_TEAM_ID: TeamPresetId = 'duo';

/** Human-readable pair label, e.g. `` `planner` → `builder` ``. */
export function formatHandoffPairLabel(pair: { fromRole: string; toRole: string }): string {
  return `\`${pair.fromRole}\` → \`${pair.toRole}\``;
}

/**
 * Structural input to {@link formatHandoffTemplateCommand}.
 *
 * The formatter only interpolates text, so it accepts any team token: a
 * validated {@link HandoffTemplatePair}, a placeholder, or the raw team a user
 * typed when a legacy-flag error echoes their input back. Team validation lives
 * at the resolver boundary (`isTeamPresetId`), not here.
 */
export interface HandoffTemplateCommandTarget {
  teamId: string;
  fromRole: string;
  toRole: string;
}

/**
 * Copy/paste-ready command that addresses a pair.
 *
 * `modeArg` is written verbatim, so pass `<chat|code|code:enhanced>` for
 * placeholders. When omitted, no `--mode` flag is emitted.
 */
export function formatHandoffTemplateCommand(
  command: HandoffTemplateCommandName,
  pair: HandoffTemplateCommandTarget,
  cliEnvPrefix = '',
  modeArg?: string
): string {
  const modeFlag = modeArg === undefined ? '' : ` --mode="${modeArg}"`;
  return `${cliEnvPrefix}chatroom handoff ${command} --from="${pair.fromRole}" --to="${pair.toRole}"${modeFlag} --team-id="${pair.teamId}"`;
}

type MissingFlags = '--from, --to' | '--from' | '--to';

/** `MISSING_PAIR` message: both `--from`/`--to` are required. */
export function missingPairMessage(
  command: HandoffTemplateCommandName,
  missing: MissingFlags
): string {
  return [
    `handoff ${command} requires both --from and --to (missing: ${missing}). Handoff templates are keyed by the (sender, recipient) pair.`,
    `Example: chatroom handoff ${command} --from="planner" --to="builder" --mode="code" --team-id="duo"`,
  ].join('\n');
}

/** `MISSING_MODE` message: `--mode` is required after the pair resolves. */
export function missingModeMessage(command: HandoffTemplateCommandName): string {
  return [
    `handoff ${command} requires --mode (missing: --mode). Handoff templates are keyed by the (sender, recipient) pair and the conversation mode.`,
    `Example: chatroom handoff ${command} --from="planner" --to="user" --mode="chat" --team-id="duo"`,
  ].join('\n');
}

/** `UNKNOWN_MODE` message. */
export function unknownModeMessage(mode: string): string {
  return `Unknown mode "${mode}". Valid modes: ${CONVERSATION_MODES.join(', ')}.`;
}

export interface LegacyRoleFlagsMessageInput {
  teamId: string;
  legacyRole?: string | undefined;
  legacyNextRole?: string | undefined;
  /** Supplied `--mode`, if any; otherwise the rewritten command shows the placeholder. */
  mode?: string | undefined;
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
  const modeArg = input.mode ?? '<chat|code|code:enhanced>';

  if (input.legacyRole !== undefined && input.legacyNextRole !== undefined) {
    return [
      header,
      `Use: ${formatHandoffTemplateCommand(
        command,
        {
          teamId: input.teamId,
          fromRole: input.legacyRole,
          toRole: input.legacyNextRole,
        },
        '',
        modeArg
      )}`,
    ].join('\n');
  }

  if (input.legacyRole !== undefined && input.rolePairs && input.rolePairs.length > 0) {
    return [
      header,
      `Pairs from "${input.legacyRole}" in team "${input.teamId}":`,
      ...input.rolePairs.map(
        (pair) => `  ${formatHandoffTemplateCommand(command, pair, '', modeArg)}`
      ),
    ].join('\n');
  }

  const to = input.legacyNextRole ?? '<recipient-role>';
  return [
    header,
    `Use: chatroom handoff ${command} --from="<your-role>" --to="${to}" --mode="${modeArg}" --team-id="${input.teamId}"`,
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
