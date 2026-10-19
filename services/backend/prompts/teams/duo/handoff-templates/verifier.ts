import { getVerifierPlannerChatTemplate } from './verifier-planner-chat';
import { getVerifierPlannerCodeTemplate } from './verifier-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoVerifierHandoffContract = {
  role: 'verifier',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getVerifierPlannerChatTemplate,
      code: getVerifierPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'verifier'>;
