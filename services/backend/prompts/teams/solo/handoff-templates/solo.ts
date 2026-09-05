/**
 * Solo role-owned handoff contract.
 *
 * The solo agent is the only team member: it receives work from the user and
 * the enhancer and returns work to the user (or back to the enhancer for a
 * request-first advisory pass).
 */

import { getSoloToUserReportTemplate } from './solo-to-user';
import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToEnhancerHandoffTemplate } from '../../../enhancer/handoff-templates.js';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';

export const soloHandoffContract: RoleHandoffContract = {
  role: 'solo',
  receivesFrom: ['user', 'enhancer'],
  returnsTo: ['user', 'enhancer'],
  outboundTemplates: {
    enhancer: () => getEntryPointToEnhancerHandoffTemplate('solo'),
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
