import { getPromptEngineerPlannerChatTemplate } from './prompt-engineer-planner-chat';
import { getPromptEngineerPlannerCodeTemplate } from './prompt-engineer-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoPromptEngineerHandoffContract = {
  role: 'prompt-engineer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getPromptEngineerPlannerChatTemplate,
      code: getPromptEngineerPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'prompt-engineer'>;
