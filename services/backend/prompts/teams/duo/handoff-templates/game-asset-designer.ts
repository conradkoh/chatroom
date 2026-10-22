import { getGameAssetDesignerPlannerChatTemplate } from './game-asset-designer-planner-chat';
import { getGameAssetDesignerPlannerCodeTemplate } from './game-asset-designer-planner-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoGameAssetDesignerHandoffContract = {
  role: 'game-asset-designer',
  receivesFrom: ['planner'],
  returnsTo: ['planner'],
  outboundTemplates: {
    planner: handoffTemplateByMode({
      chat: getGameAssetDesignerPlannerChatTemplate,
      code: getGameAssetDesignerPlannerCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'game-asset-designer'>;
