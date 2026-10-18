import { getUiuxEngineerPlannerChatTemplate } from './uiux-engineer-planner-chat';
import { getUiuxEngineerPlannerCodeTemplate } from './uiux-engineer-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoUiuxEngineerHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getUiuxEngineerPlannerChatTemplate,
      code: getUiuxEngineerPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'uiux-engineer'>;
