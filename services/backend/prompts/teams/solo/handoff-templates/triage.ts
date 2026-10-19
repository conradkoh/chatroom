import { getTriageSoloChatTemplate } from './triage-solo-chat';
import { getTriageSoloCodeTemplate } from './triage-solo-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const soloTriageHandoffContract = {
  role: 'triage',
  receivesFrom: ['solo'],
  returnsTo: ['solo'],
  outboundTemplates: {
    solo: handoffTemplateByMode({
      chat: getTriageSoloChatTemplate,
      code: getTriageSoloCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'solo', 'triage'>;
