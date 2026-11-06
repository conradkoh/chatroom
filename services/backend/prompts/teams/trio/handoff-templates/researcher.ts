import { getResearcherCoordinatorChatTemplate } from './researcher-coordinator-chat';
import { getResearcherCoordinatorCodeTemplate } from './researcher-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioResearcherHandoffContract = {
  role: 'researcher',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getResearcherCoordinatorChatTemplate,
      code: getResearcherCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'researcher'>;
