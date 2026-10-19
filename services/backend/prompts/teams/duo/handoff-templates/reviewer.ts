import { getReviewerPlannerChatTemplate } from './reviewer-planner-chat';
import { getReviewerPlannerCodeTemplate } from './reviewer-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoReviewerHandoffContract = {
  role: 'reviewer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getReviewerPlannerChatTemplate,
      code: getReviewerPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'reviewer'>;
