import { getVerifierSoloChatTemplate } from './verifier-solo-chat';
import { getVerifierSoloCodeTemplate } from './verifier-solo-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const soloVerifierHandoffContract = {
  role: 'verifier',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: handoffTemplateByMode({
      chat: getVerifierSoloChatTemplate,
      code: getVerifierSoloCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'verifier'>;
