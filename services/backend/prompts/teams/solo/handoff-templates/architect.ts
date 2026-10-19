import { getArchitectSoloChatTemplate } from './architect-solo-chat';
import { getArchitectSoloCodeTemplate } from './architect-solo-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const soloArchitectHandoffContract = {
  role: 'architect',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: handoffTemplateByMode({
      chat: getArchitectSoloChatTemplate,
      code: getArchitectSoloCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'architect'>;
