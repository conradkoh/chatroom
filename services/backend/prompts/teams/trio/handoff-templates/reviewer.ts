import { getReviewerCoordinatorChatTemplate } from './reviewer-coordinator-chat';
import { getReviewerCoordinatorCodeTemplate } from './reviewer-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioReviewerHandoffContract = {
  role: 'reviewer',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getReviewerCoordinatorChatTemplate,
      code: getReviewerCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'reviewer'>;
