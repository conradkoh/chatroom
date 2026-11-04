import { getTriageCoordinatorChatTemplate } from './triage-coordinator-chat';
import { getTriageCoordinatorCodeTemplate } from './triage-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioTriageHandoffContract = {
  role: 'triage',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getTriageCoordinatorChatTemplate,
      code: getTriageCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'triage'>;
