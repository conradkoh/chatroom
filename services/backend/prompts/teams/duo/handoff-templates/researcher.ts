import { getResearcherPlannerChatTemplate } from './researcher-planner-chat';
import { getResearcherPlannerCodeTemplate } from './researcher-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoResearcherHandoffContract = {
  role: 'researcher',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getResearcherPlannerChatTemplate,
      code: getResearcherPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'researcher'>;
