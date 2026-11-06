import { getUiuxEngineerCoordinatorChatTemplate } from './uiux-engineer-coordinator-chat';
import { getUiuxEngineerCoordinatorCodeTemplate } from './uiux-engineer-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioUiuxEngineerHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getUiuxEngineerCoordinatorChatTemplate,
      code: getUiuxEngineerCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'uiux-engineer'>;
