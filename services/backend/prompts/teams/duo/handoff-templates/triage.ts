import { getTriagePlannerChatTemplate } from './triage-planner-chat';
import { getTriagePlannerCodeTemplate } from './triage-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoTriageHandoffContract = {
  role: 'triage',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getTriagePlannerChatTemplate,
      code: getTriagePlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'triage'>;
