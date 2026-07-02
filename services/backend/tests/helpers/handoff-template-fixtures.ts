/**
 * Canonical params for handoff template unit tests.
 *
 * Matches integration test delivery (get-next-task / native task delivery) so
 * PR reviewers can audit full template output — including HTML comment hints
 * with resolved CLI commands — from handoff-templates.test.ts snapshots.
 */

import { getHandoffTemplate, type HandoffTemplateQuery } from '../../prompts/cli/handoff-templates';

/** Stable chatroom id used across prompt integration snapshots. */
export const HANDOFF_TEMPLATE_FIXTURE_CHATROOM_ID = '000000000000010002chatroom_rooms';

/** Non-production CLI env prefix matching integration tests. */
export const HANDOFF_TEMPLATE_FIXTURE_CLI_ENV_PREFIX = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';

/** Params passed when templates are inlined on task delivery. */
export function handoffTemplateDeliveryParams(
  role: string
): Pick<HandoffTemplateQuery, 'chatroomId' | 'role' | 'cliEnvPrefix'> {
  return {
    chatroomId: HANDOFF_TEMPLATE_FIXTURE_CHATROOM_ID,
    role,
    cliEnvPrefix: HANDOFF_TEMPLATE_FIXTURE_CLI_ENV_PREFIX,
  };
}

/** Resolve a handoff template with delivery-time params (ids + CLI prefix). */
export function resolveDeliveredHandoffTemplate(
  query: Pick<HandoffTemplateQuery, 'teamId' | 'fromRole' | 'toRole' | 'nativeIntegration'> & {
    role: string;
  }
): string | null {
  return getHandoffTemplate({
    ...handoffTemplateDeliveryParams(query.role),
    teamId: query.teamId,
    fromRole: query.fromRole,
    toRole: query.toRole,
    nativeIntegration: query.nativeIntegration,
  });
}
