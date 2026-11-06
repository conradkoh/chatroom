import { getArchitectCoordinatorChatTemplate } from './architect-coordinator-chat';
import { getArchitectCoordinatorCodeTemplate } from './architect-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioArchitectHandoffContract = {
  role: 'architect',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getArchitectCoordinatorChatTemplate,
      code: getArchitectCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'architect'>;
