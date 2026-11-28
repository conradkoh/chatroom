import { getPromptEngineerSoloChatTemplate } from './prompt-engineer-solo-chat';
import { getPromptEngineerSoloCodeTemplate } from './prompt-engineer-solo-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const soloPromptEngineerHandoffContract = {
  role: 'prompt-engineer',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: handoffTemplateByMode({
      chat: getPromptEngineerSoloChatTemplate,
      code: getPromptEngineerSoloCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'prompt-engineer'>;
