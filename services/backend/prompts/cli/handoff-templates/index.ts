/**
 * Barrel + resolver for role-specific handoff templates.
 *
 * Handoff templates provide good structure for how a role hands work off to
 * the next role.
 *
 * Team-specific templates live under prompts/teams/{team}/handoff-templates/.
 * The pair resolver (`getHandoffTemplate`) remains a compatibility facade over
 * the role-owned catalogs; `listHandoffTemplates` exposes the deterministic
 * role-level capability/catalog read used by the discovery command.
 */
// fallow-ignore-file unused-type

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import type {
  HandoffTemplateDescriptor,
  HandoffTemplateQuery,
  RoleHandoffContract,
} from './contracts';
import {
  getDuoHandoffTemplate,
  listDuoRoleHandoffContracts,
} from '../../teams/duo/handoff-templates';
import {
  getSoloHandoffTemplate,
  listSoloRoleHandoffContracts,
} from '../../teams/solo/handoff-templates';

export type { HandoffTemplateQuery } from './contracts';

export interface ListHandoffTemplatesQuery {
  teamId?: string | undefined;
  role: string;
  nativeIntegration?: boolean | undefined;
  chatroomId?: string | undefined;
  cliEnvPrefix?: string | undefined;
  conversationMode?: ConversationMode | undefined;
}

export interface RoleHandoffTemplateListing {
  teamId: string;
  role: string;
  receivesFrom: readonly string[];
  returnsTo: readonly string[];
  templates: readonly HandoffTemplateDescriptor[];
}

function resolveTeamContracts(teamId: string | undefined): readonly RoleHandoffContract[] | null {
  const team = (teamId ?? 'duo').toLowerCase();
  if (team === 'duo') return listDuoRoleHandoffContracts();
  if (team === 'solo') return listSoloRoleHandoffContracts();
  return null;
}

/**
 * Static role-level catalog read. Returns the role contract's receives/returns
 * metadata plus every renderable outbound template (null results omitted).
 * Returns `null` for unknown teams/roles — the listing never throws.
 */
// fallow-ignore-next-line complexity
export function listHandoffTemplates(
  query: ListHandoffTemplatesQuery
): RoleHandoffTemplateListing | null {
  const teamId = (query.teamId ?? 'duo').toLowerCase();
  const contracts = resolveTeamContracts(teamId);
  if (!contracts) return null;
  const contract = contracts.find(
    (candidate) => candidate.role.toLowerCase() === query.role.toLowerCase()
  );
  if (!contract) return null;

  const templates: HandoffTemplateDescriptor[] = [];
  // Deterministic order: sort outbound targets alphabetically.
  for (const toRole of Object.keys(contract.outboundTemplates).sort()) {
    const getter = contract.outboundTemplates[toRole];
    const template = getter({
      fromRole: contract.role,
      toRole,
      teamId,
      nativeIntegration: query.nativeIntegration,
      chatroomId: query.chatroomId,
      role: contract.role,
      cliEnvPrefix: query.cliEnvPrefix,
      conversationMode: query.conversationMode,
    });
    if (!template) continue;
    templates.push({ fromRole: contract.role, toRole, template });
  }

  return {
    teamId,
    role: contract.role,
    receivesFrom: [...contract.receivesFrom],
    returnsTo: [...contract.returnsTo],
    templates,
  };
}

/**
 * Resolves the handoff template for a given (fromRole → toRole) pair.
 *
 * Returns `null` when no specialized template exists for the pair — callers
 * fall back to the generic free-form handoff message in that case.
 */
export function getHandoffTemplate(query: HandoffTemplateQuery): string | null {
  const team = (query.teamId ?? 'duo').toLowerCase();
  if (team === 'duo') return getDuoHandoffTemplate(query);
  if (team === 'solo') return getSoloHandoffTemplate(query);
  return null;
}
