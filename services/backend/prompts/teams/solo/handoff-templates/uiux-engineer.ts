import { getUiuxEngineerSoloChatTemplate } from './uiux-engineer-solo-chat';
import { getUiuxEngineerSoloCodeTemplate } from './uiux-engineer-solo-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const soloUiuxEngineerHandoffContract = {
  role: 'uiux-engineer',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: handoffTemplateByMode({
      chat: getUiuxEngineerSoloChatTemplate,
      code: getUiuxEngineerSoloCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'uiux-engineer'>;
