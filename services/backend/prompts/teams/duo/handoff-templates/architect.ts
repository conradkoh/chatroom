import { getArchitectPlannerChatTemplate } from './architect-planner-chat';
import { getArchitectPlannerCodeTemplate } from './architect-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoArchitectHandoffContract = {
  role: 'architect',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getArchitectPlannerChatTemplate,
      code: getArchitectPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'architect'>;
