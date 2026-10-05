/**
 * Solo role-owned handoff contract.
 *
 * The solo agent is the only team member: it receives work from and returns
 * work to the user.
 */

import { getSoloToUserReportTemplate } from './solo-to-user';
import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';
import { getEntryPointToArchitectHandoffTemplate } from '../../architect-handoff-templates';
import { getEntryPointToTriageHandoffTemplate } from '../../triage-handoff-templates';
import { getEntryPointToUiuxEngineerHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const soloHandoffContract = {
  role: 'solo',
  receivesFrom: ['user', 'architect', 'uiux-engineer', 'triage'],
  returnsTo: ['architect', 'uiux-engineer', 'triage', 'user'],
  outboundTemplates: {
    architect: () => getEntryPointToArchitectHandoffTemplate('solo'),
    'uiux-engineer': () => getEntryPointToUiuxEngineerHandoffTemplate('solo'),
    triage: () => getEntryPointToTriageHandoffTemplate('solo'),
    user: (query) =>
      query.conversationMode === 'chat'
        ? getChatToUserHandoffTemplate()
        : getSoloToUserReportTemplate({
            chatroomId: query.chatroomId,
            role: query.role,
            cliEnvPrefix: query.cliEnvPrefix,
          }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'solo'>;
