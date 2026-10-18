/**
 * Duo planner role-owned handoff contract.
 *
 * The duo planner owns its outbound targets (builder, user). It receives work
 * from the user and the builder (handbacks).
 */

import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerUserChatTemplate } from './planner-user-chat';
import { getPlannerUserCodeTemplate } from './planner-user-code';
import type { BuiltinTeamRoleHandoffContract } from '../../../cli/handoff-templates/contracts';
import { getEntryPointToArchitectHandoffTemplate } from '../../architect-handoff-templates';
import { getEntryPointToResearcherHandoffTemplate } from '../../researcher-handoff-templates';
import { getEntryPointToTriageHandoffTemplate } from '../../triage-handoff-templates';
import { getEntryPointToUiuxEngineerHandoffTemplate } from '../../uiux-engineer-handoff-templates';
import { getEntryPointToVerifierHandoffTemplate } from '../../verifier-handoff-templates';

export const duoPlannerHandoffContract = {
  role: 'planner',
  receivesFrom: [
    'user',
    'builder',
    'architect',
    'uiux-engineer',
    'triage',
    'researcher',
    'verifier',
  ],
  returnsTo: ['user', 'builder', 'architect', 'uiux-engineer', 'triage', 'researcher', 'verifier'],
  outboundTemplates: {
    builder: () => getPlannerToBuilderHandoffTemplate(),
    architect: getEntryPointToArchitectHandoffTemplate,
    'uiux-engineer': getEntryPointToUiuxEngineerHandoffTemplate,
    triage: getEntryPointToTriageHandoffTemplate,
    researcher: getEntryPointToResearcherHandoffTemplate,
    verifier: getEntryPointToVerifierHandoffTemplate,
    user: (query) =>
      query.conversationMode === 'chat'
        ? getPlannerUserChatTemplate()
        : getPlannerUserCodeTemplate({
            chatroomId: query.chatroomId,
            role: query.role,
            cliEnvPrefix: query.cliEnvPrefix,
          }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'planner'>;
