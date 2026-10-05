/**
 * Duo planner role-owned handoff contract.
 *
 * The duo planner owns its outbound targets (builder, user). It receives work
 * from the user and the builder (handbacks).
 */

import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToUserReportTemplate } from './planner-to-user';
import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';
import { getEntryPointToArchitectHandoffTemplate } from '../../architect-handoff-templates';
import { getEntryPointToTriageHandoffTemplate } from '../../triage-handoff-templates';
import { getEntryPointToUiuxEngineerHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const duoPlannerHandoffContract = {
  role: 'planner',
  receivesFrom: ['user', 'builder', 'architect', 'uiux-engineer', 'triage'],
  returnsTo: ['builder', 'architect', 'uiux-engineer', 'triage', 'user'],
  outboundTemplates: {
    builder: () => getPlannerToBuilderHandoffTemplate(),
    architect: () => getEntryPointToArchitectHandoffTemplate('planner'),
    'uiux-engineer': () => getEntryPointToUiuxEngineerHandoffTemplate('planner'),
    triage: () => getEntryPointToTriageHandoffTemplate('planner'),
    user: (query) =>
      query.conversationMode === 'chat'
        ? getChatToUserHandoffTemplate()
        : getPlannerToUserReportTemplate({
            chatroomId: query.chatroomId,
            role: query.role,
            cliEnvPrefix: query.cliEnvPrefix,
          }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'planner'>;
