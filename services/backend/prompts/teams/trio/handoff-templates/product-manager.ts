import { getProductManagerCoordinatorChatTemplate } from './product-manager-coordinator-chat';
import { getProductManagerCoordinatorCodeTemplate } from './product-manager-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioProductManagerHandoffContract = {
  role: 'product-manager',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getProductManagerCoordinatorChatTemplate,
      code: getProductManagerCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'product-manager'>;
