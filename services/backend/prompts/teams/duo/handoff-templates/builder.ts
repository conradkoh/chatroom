/**
 * Duo builder role-owned handoff contract.
 *
 * The duo builder receives work from the planner and returns work to the
 * planner only.
 */

import { getBuilderToPlannerHandoffTemplate } from './builder-to-planner';
import type { RoleHandoffContract } from '../../../cli/handoff-templates/contracts';

export const duoBuilderHandoffContract: RoleHandoffContract = {
  role: 'builder',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: (query) =>
      getBuilderToPlannerHandoffTemplate({
        chatroomId: query.chatroomId,
        role: query.role,
        cliEnvPrefix: query.cliEnvPrefix,
      }),
  },
};
