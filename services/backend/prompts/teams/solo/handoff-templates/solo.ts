/**
 * Solo role-owned handoff contract.
 *
 * The solo agent is the only team member: it receives work from and returns
 * work to the user. Each target selects its key file by conversation mode
 * through `handoffTemplateByMode`.
 */

import { getSoloArchitectChatTemplate } from './solo-architect-chat';
import { getSoloArchitectCodeTemplate } from './solo-architect-code';
import { getSoloTriageChatTemplate } from './solo-triage-chat';
import { getSoloTriageCodeTemplate } from './solo-triage-code';
import { getSoloUiuxEngineerChatTemplate } from './solo-uiux-engineer-chat';
import { getSoloUiuxEngineerCodeTemplate } from './solo-uiux-engineer-code';
import { getSoloUserChatTemplate } from './solo-user-chat';
import { getSoloUserCodeTemplate } from './solo-user-code';
import { getSoloVerifierChatTemplate } from './solo-verifier-chat';
import { getSoloVerifierCodeTemplate } from './solo-verifier-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const soloHandoffContract = {
  role: 'solo',
  receivesFrom: ['user', 'architect', 'uiux-engineer', 'triage', 'verifier'],
  returnsTo: ['user', 'architect', 'uiux-engineer', 'triage', 'verifier'],
  outboundTemplates: {
    architect: handoffTemplateByMode({
      chat: getSoloArchitectChatTemplate,
      code: getSoloArchitectCodeTemplate,
    }),
    'uiux-engineer': handoffTemplateByMode({
      chat: getSoloUiuxEngineerChatTemplate,
      code: getSoloUiuxEngineerCodeTemplate,
    }),
    triage: handoffTemplateByMode({
      chat: getSoloTriageChatTemplate,
      code: getSoloTriageCodeTemplate,
    }),
    verifier: handoffTemplateByMode({
      chat: getSoloVerifierChatTemplate,
      code: getSoloVerifierCodeTemplate,
    }),
    user: handoffTemplateByMode({
      chat: getSoloUserChatTemplate,
      code: getSoloUserCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'solo'>;
