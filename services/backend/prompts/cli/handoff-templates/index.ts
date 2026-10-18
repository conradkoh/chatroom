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
  isTeamPresetId,
  legacyRoleFlagsMessage,
  missingPairMessage,
  normalizeHandoffRole,
  unknownFromRoleMessage,
  unknownPairMessage,
  unknownTeamMessage,
  type HandoffTemplateCommandName,
  type HandoffTemplatePair,
  type HandoffTemplatePairInput,
} from './pair';
import { listDuoRoleHandoffContracts } from '../../teams/duo/handoff-templates';
import { listSoloRoleHandoffContracts } from '../../teams/solo/handoff-templates';

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
// fallow-ignore-next-line complexity
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
 * Renders the pair's outbound getter, or `null` when the pair has no template.
 *
 * Phase A: the getter output is returned as-is; a null getter result stays null.
 */
export function renderHandoffTemplate(
  pair: HandoffTemplatePair,
  options?: HandoffTemplateRenderOptions
): string | null {
  const contract = BUILTIN_TEAM_HANDOFF_CONTRACTS[pair.teamId].find(
    (candidate) => candidate.role.toLowerCase() === pair.fromRole
  );
  const getter = contract?.outboundTemplates[pair.toRole];
  return (
    getter?.({
      ...options,
      teamId: pair.teamId,
      fromRole: pair.fromRole,
      toRole: pair.toRole,
      role: pair.fromRole,
    }) ?? null
  );
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
