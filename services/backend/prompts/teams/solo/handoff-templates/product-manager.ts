import { getProductManagerSoloChatTemplate } from './product-manager-solo-chat';
import { getProductManagerSoloCodeTemplate } from './product-manager-solo-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const soloProductManagerHandoffContract = {
  role: 'product-manager',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: handoffTemplateByMode({
      chat: getProductManagerSoloChatTemplate,
      code: getProductManagerSoloCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'product-manager'>;
