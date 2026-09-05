/**
 * Barrel + resolver for role-specific handoff templates.
 *
 * Handoff templates provide good structure for how a role hands work off to
 * the next role.
 *
 * Team-specific templates live under prompts/teams/{team}/handoff-templates/.
 * This module resolves templates by team and re-exports duo getters for tests.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

import { getDuoHandoffTemplate } from '../../teams/duo/handoff-templates';
import { getSoloHandoffTemplate } from '../../teams/solo/handoff-templates';

export interface HandoffTemplateQuery {
  fromRole: string;
  toRole: string;
  teamId?: string | undefined;
  nativeIntegration?: boolean | undefined;
  chatroomId?: string | undefined;
  role?: string | undefined;
  cliEnvPrefix?: string | undefined;
  conversationMode?: ConversationMode | undefined;
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
