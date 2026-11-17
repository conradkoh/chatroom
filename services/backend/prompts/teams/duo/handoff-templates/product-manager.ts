import { getProductManagerPlannerChatTemplate } from './product-manager-planner-chat';
import { getProductManagerPlannerCodeTemplate } from './product-manager-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoProductManagerHandoffContract = {
  role: 'product-manager',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getProductManagerPlannerChatTemplate,
      code: getProductManagerPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'product-manager'>;
