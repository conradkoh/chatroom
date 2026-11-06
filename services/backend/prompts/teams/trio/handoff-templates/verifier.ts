import { getVerifierCoordinatorChatTemplate } from './verifier-coordinator-chat';
import { getVerifierCoordinatorCodeTemplate } from './verifier-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioVerifierHandoffContract = {
  role: 'verifier',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getVerifierCoordinatorChatTemplate,
      code: getVerifierCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'verifier'>;
