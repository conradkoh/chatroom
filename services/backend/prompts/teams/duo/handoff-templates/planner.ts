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
import { getEntryPointToSpecialistHandoffTemplate } from '../../specialist-handoff-templates';

export const duoPlannerHandoffContract: RoleHandoffContract = {
  role: 'planner',
  receivesFrom: ['user', 'builder', 'architect', 'uiux-engineer'],
  returnsTo: ['builder', 'architect', 'uiux-engineer', 'user'],
  outboundTemplates: {
    builder: () => getPlannerToBuilderHandoffTemplate(),
    architect: () => getEntryPointToSpecialistHandoffTemplate('planner', 'architect'),
    'uiux-engineer': () => getEntryPointToSpecialistHandoffTemplate('planner', 'uiux-engineer'),
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
