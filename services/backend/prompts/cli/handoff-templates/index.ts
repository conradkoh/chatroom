/**
 * Pair resolver for role-specific handoff templates.
 *
 * Handoff templates provide good structure for how a role hands work off to
 * the next role.
 *
 * The role-owned catalogs (`DUO_ROLE_HANDOFF_CATALOG`, `SOLO_ROLE_HANDOFF_CATALOG`)
 * are the single registry. Pairs are derived from each contract's `returnsTo`
 * order and rendered through its `outboundTemplates` getter — there is no
 * separate flat pair registry. `getHandoffTemplate` remains a compatibility
 * facade over that resolver; the CLI commands resolve explicit pairs.
 */
// fallow-ignore-file unused-type

import type { TeamPresetId } from '@workspace/shared/domain/team-kind';

import type { HandoffTemplateQuery, RoleHandoffContract } from './contracts';
import {
  HandoffTemplatePairError,
  isConversationMode,
  isTeamPresetId,
  legacyRoleFlagsMessage,
  missingModeMessage,
  missingPairMessage,
  normalizeHandoffMode,
  normalizeHandoffRole,
  unknownFromRoleMessage,
  unknownModeMessage,
  unknownPairMessage,
  unknownTeamMessage,
  type HandoffTemplateCommandName,
  type HandoffTemplatePair,
  type HandoffTemplatePairInput,
  type HandoffTemplateSelection,
} from './pair';
import { getHandoffRecipientVisibilityCallout } from '../../native/handoff-visibility';
import { listDuoRoleHandoffContracts } from '../../teams/duo/handoff-templates';
import { listSoloRoleHandoffContracts } from '../../teams/solo/handoff-templates';
import { getHandoffTemplateTitleLine } from '../../utils/handoff-section-guidance';

export type { HandoffTemplateQuery } from './contracts';
export type { HandoffTemplatePair, HandoffTemplatePairInput } from './pair';

/** Single team dispatch: the validated role-owned catalogs keyed by team. */
const BUILTIN_TEAM_HANDOFF_CONTRACTS: Readonly<
  Record<TeamPresetId, readonly RoleHandoffContract[]>
> = {
  duo: listDuoRoleHandoffContracts(),
  solo: listSoloRoleHandoffContracts(),
};

/** Options passed through to a pair getter (everything but the pair key itself). */
export type HandoffTemplateRenderOptions = Omit<
  HandoffTemplateQuery,
  'fromRole' | 'toRole' | 'teamId' | 'role'
>;

/**
 * Pairs in contract `returnsTo` order. `fromRole` omitted → every pair for the
 * team in catalog order. Unknown team or unknown role → `[]`.
 */
// fallow-ignore-next-line complexity
export function listHandoffTemplatePairs(
  teamId: string | undefined,
  fromRole?: string
): readonly HandoffTemplatePair[] {
  const team = (teamId ?? 'duo').trim().toLowerCase();
  if (!isTeamPresetId(team)) return [];

  const normalizedFrom = fromRole === undefined ? undefined : fromRole.trim().toLowerCase();
  const contracts =
    normalizedFrom === undefined
      ? BUILTIN_TEAM_HANDOFF_CONTRACTS[team]
      : BUILTIN_TEAM_HANDOFF_CONTRACTS[team].filter(
          (contract) => contract.role.toLowerCase() === normalizedFrom
        );

  return contracts.flatMap((contract) =>
    contract.returnsTo.map((toRole) => ({
      teamId: team,
      fromRole: contract.role,
      toRole,
    }))
  );
}

/**
 * Resolves the canonical pair from raw input.
 *
 * Precedence: an explicit `from`+`to` pair wins (legacy flags ignored); any
 * legacy flag yields `LEGACY_ROLE_FLAGS`; otherwise `MISSING_PAIR`, then
 * `UNKNOWN_TEAM`, `UNKNOWN_FROM_ROLE`, and `UNKNOWN_PAIR`. Inputs are trimmed
 * and lowercased and `teamId` defaults to `duo`. Throws
 * {@link HandoffTemplatePairError}.
 */
// Reason: the pair-only resolver remains public (signature frozen) and is used by
// resolveHandoffTemplateSelection and the resolver tests.
// fallow-ignore-next-line unused-export complexity
export function resolveHandoffTemplatePair(
  input: HandoffTemplatePairInput,
  command: HandoffTemplateCommandName
): HandoffTemplatePair {
  const from = normalizeHandoffRole(input.from);
  const to = normalizeHandoffRole(input.to);
  const legacyRole = normalizeHandoffRole(input.legacyRole);
  const legacyNextRole = normalizeHandoffRole(input.legacyNextRole);
  const team = (input.teamId ?? 'duo').trim().toLowerCase();

  if (from !== undefined && to !== undefined) {
    if (!isTeamPresetId(team)) {
      throw new HandoffTemplatePairError('UNKNOWN_TEAM', unknownTeamMessage(team));
    }
    const contracts = BUILTIN_TEAM_HANDOFF_CONTRACTS[team];
    const contract = contracts.find((candidate) => candidate.role.toLowerCase() === from);
    if (!contract) {
      throw new HandoffTemplatePairError(
        'UNKNOWN_FROM_ROLE',
        unknownFromRoleMessage({ from, team, roles: contracts.map((c) => c.role) })
      );
    }
    if (!contract.returnsTo.includes(to)) {
      throw new HandoffTemplatePairError(
        'UNKNOWN_PAIR',
        unknownPairMessage({ from, to, team, recipients: contract.returnsTo })
      );
    }
    return { teamId: team, fromRole: contract.role, toRole: to };
  }

  if (legacyRole !== undefined || legacyNextRole !== undefined) {
    throw new HandoffTemplatePairError(
      'LEGACY_ROLE_FLAGS',
      legacyRoleFlagsMessage(command, {
        teamId: team,
        legacyRole,
        legacyNextRole,
        mode: normalizeHandoffMode(input.mode),
        rolePairs:
          legacyRole === undefined ? undefined : listHandoffTemplatePairs(team, legacyRole),
      })
    );
  }

  const missing =
    from === undefined && to === undefined
      ? '--from, --to'
      : from === undefined
        ? '--from'
        : '--to';
  throw new HandoffTemplatePairError('MISSING_PAIR', missingPairMessage(command, missing));
}

/**
 * Resolves the pair (existing rules), then the conversation mode.
 *
 * Missing mode → `MISSING_MODE`; unknown mode → `UNKNOWN_MODE`. Pair errors
 * keep precedence because the pair resolves first. Throws
 * {@link HandoffTemplatePairError}.
 */
export function resolveHandoffTemplateSelection(
  input: HandoffTemplatePairInput,
  command: HandoffTemplateCommandName
): HandoffTemplateSelection {
  const pair = resolveHandoffTemplatePair(input, command);
  const mode = normalizeHandoffMode(input.mode);
  if (mode === undefined) {
    throw new HandoffTemplatePairError('MISSING_MODE', missingModeMessage(command));
  }
  if (!isConversationMode(mode)) {
    throw new HandoffTemplatePairError('UNKNOWN_MODE', unknownModeMessage(mode));
  }
  return { pair, mode };
}

/**
 * Renders the pair's outbound getter, composing the recipient callout and the
 * pair title line around the getter's body text.
 *
 * The getter returns body text only (or `null` when the pair has no template);
 * a `null` getter result stays `null` so callers can fall back to the generic
 * free-form handoff message. The `null` contract never throws.
 */
export function renderHandoffTemplate(
  pair: HandoffTemplatePair,
  options?: HandoffTemplateRenderOptions
): string | null {
  const contract = BUILTIN_TEAM_HANDOFF_CONTRACTS[pair.teamId].find(
    (candidate) => candidate.role.toLowerCase() === pair.fromRole
  );
  const getter = contract?.outboundTemplates[pair.toRole];
  if (!getter) return null;
  const body = getter({
    ...options,
    teamId: pair.teamId,
    fromRole: pair.fromRole,
    toRole: pair.toRole,
    role: pair.fromRole,
  });
  if (!body) return null;
  return [
    getHandoffRecipientVisibilityCallout(pair.toRole),
    getHandoffTemplateTitleLine(pair),
    body,
  ].join('\n\n');
}

/**
 * Reply pair (`to` → `from`) when `to` is a catalog role with an outbound
 * template back to `from`; `null` for `user` or any role without that edge.
 */
export function getReplyHandoffTemplatePair(pair: HandoffTemplatePair): HandoffTemplatePair | null {
  const contract = BUILTIN_TEAM_HANDOFF_CONTRACTS[pair.teamId].find(
    (candidate) => candidate.role.toLowerCase() === pair.toRole
  );
  const getter = contract?.outboundTemplates[pair.fromRole];
  if (!getter) return null;
  return { teamId: pair.teamId, fromRole: pair.toRole, toRole: pair.fromRole };
}

/**
 * Compatibility facade over the pair resolver: resolves the handoff template
 * for a `(fromRole → toRole)` pair, returning `null` — never throwing — when
 * the team is custom or the pair has no specialized template. Callers fall
 * back to the generic free-form handoff message on `null`.
 */
// fallow-ignore-next-line complexity
export function getHandoffTemplate(query: HandoffTemplateQuery): string | null {
  const team = (query.teamId ?? 'duo').trim().toLowerCase();
  const fromRole = normalizeHandoffRole(query.fromRole);
  const toRole = normalizeHandoffRole(query.toRole);
  if (!isTeamPresetId(team) || fromRole === undefined || toRole === undefined) return null;

  const pair = listHandoffTemplatePairs(team, fromRole).find(
    (candidate) => candidate.toRole === toRole
  );
  if (!pair) return null;

  return renderHandoffTemplate(pair, {
    nativeIntegration: query.nativeIntegration,
    chatroomId: query.chatroomId,
    cliEnvPrefix: query.cliEnvPrefix,
    conversationMode: query.conversationMode,
  });
}
