/**
 * Duo planner role-owned handoff contract.
 *
 * The duo planner owns its outbound targets (builder, enhancer, user). It
 * receives work from the user, the builder (handbacks), and the enhancer
 * (planning input).
 */

import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToEnhancerHandoffTemplate } from './planner-to-enhancer';
import { getPlannerToUserReportTemplate } from './planner-to-user';
import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getChatToUserHandoffTemplate } from '../../../utils/chat-handoff-template';

export const duoPlannerHandoffContract: RoleHandoffContract = {
  role: 'planner',
  receivesFrom: ['user', 'builder', 'enhancer'],
  returnsTo: ['builder', 'enhancer', 'user'],
  outboundTemplates: {
    builder: () => getPlannerToBuilderHandoffTemplate(),
    enhancer: () => getPlannerToEnhancerHandoffTemplate(),
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
