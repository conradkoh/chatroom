import { getPromptEngineerCoordinatorChatTemplate } from './prompt-engineer-coordinator-chat';
import { getPromptEngineerCoordinatorCodeTemplate } from './prompt-engineer-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioPromptEngineerHandoffContract = {
  role: 'prompt-engineer',
  receivesFrom: ['coordinator'],
  returnsTo: ['coordinator'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getPromptEngineerCoordinatorChatTemplate,
      code: getPromptEngineerCoordinatorCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'prompt-engineer'>;
