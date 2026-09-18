/**
 * Duo planner role-owned handoff contract.
 *
 * The duo planner owns its outbound targets (builder, user). It receives work
 * from the user and the builder (handbacks).
 */

import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToUserReportTemplate } from './planner-to-user';
import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';

export const duoPlannerHandoffContract: RoleHandoffContract = {
  role: 'planner',
  receivesFrom: ['user', 'builder'],
  returnsTo: ['builder', 'user'],
  outboundTemplates: {
    builder: () => getPlannerToBuilderHandoffTemplate(),
    user: (query) =>
      query.conversationMode === 'chat'
        ? getChatToUserHandoffTemplate()
        : getPlannerToUserReportTemplate({
            chatroomId: query.chatroomId,
            role: query.role,
            cliEnvPrefix: query.cliEnvPrefix,
          }),
  },
};
