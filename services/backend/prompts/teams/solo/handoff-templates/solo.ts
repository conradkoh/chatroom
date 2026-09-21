/**
 * Solo role-owned handoff contract.
 *
 * The solo agent is the only team member: it receives work from and returns
 * work to the user.
 */

import { getSoloToUserReportTemplate } from './solo-to-user';
import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';
import { getEntryPointToArchitectHandoffTemplate } from '../../architect-handoff-templates';
import { getEntryPointToUiuxEngineerHandoffTemplate } from '../../uiux-engineer-handoff-templates';

export const soloHandoffContract: RoleHandoffContract = {
  role: 'solo',
  receivesFrom: ['user', 'architect', 'uiux-engineer'],
  returnsTo: ['architect', 'uiux-engineer', 'user'],
  outboundTemplates: {
    architect: () => getEntryPointToArchitectHandoffTemplate('solo'),
    'uiux-engineer': () => getEntryPointToUiuxEngineerHandoffTemplate('solo'),
    user: (query) =>
      query.conversationMode === 'chat'
        ? getChatToUserHandoffTemplate()
        : getSoloToUserReportTemplate({
            chatroomId: query.chatroomId,
            role: query.role,
            cliEnvPrefix: query.cliEnvPrefix,
          }),
  },
};
