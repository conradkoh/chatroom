import { getGameAssetDesignerCoordinatorChatTemplate } from './game-asset-designer-coordinator-chat';
import { getGameAssetDesignerCoordinatorCodeTemplate } from './game-asset-designer-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioGameAssetDesignerHandoffContract = {
  role: 'game-asset-designer',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getGameAssetDesignerCoordinatorChatTemplate,
      code: getGameAssetDesignerCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'game-asset-designer'>;
