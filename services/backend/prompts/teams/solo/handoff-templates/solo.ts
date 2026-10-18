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
import { getEntryPointToVerifierHandoffTemplate } from '../../verifier-handoff-templates';

export const soloHandoffContract = {
  role: 'solo',
  receivesFrom: ['user', 'architect', 'uiux-engineer', 'triage', 'verifier'],
  returnsTo: ['user', 'architect', 'uiux-engineer', 'triage', 'verifier'],
  outboundTemplates: {
    architect: getEntryPointToArchitectHandoffTemplate,
    'uiux-engineer': getEntryPointToUiuxEngineerHandoffTemplate,
    triage: getEntryPointToTriageHandoffTemplate,
    verifier: getEntryPointToVerifierHandoffTemplate,
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
