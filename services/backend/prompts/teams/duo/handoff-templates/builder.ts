/**
 * Duo builder role-owned handoff contract.
 *
 * The duo builder receives work from the planner and returns work to the
 * planner only.
 */

import { getBuilderPlannerChatTemplate } from './builder-planner-chat';
import { getBuilderPlannerCodeTemplate } from './builder-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoBuilderHandoffContract = {
  role: 'builder',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getBuilderPlannerChatTemplate,
      code: getBuilderPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'builder'>;
