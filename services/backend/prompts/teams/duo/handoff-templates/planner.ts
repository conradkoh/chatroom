/**
 * Duo planner role-owned handoff contract.
 *
 * The duo planner owns its outbound targets (builder, user). It receives work
 * from the user and the builder (handbacks). Each target selects its key file
 * by conversation mode through `handoffTemplateByMode`.
 */

import { getPlannerArchitectChatTemplate } from './planner-architect-chat';
import { getPlannerArchitectCodeTemplate } from './planner-architect-code';
import { getPlannerBuilderChatTemplate } from './planner-builder-chat';
import { getPlannerBuilderCodeTemplate } from './planner-builder-code';
import { getPlannerGameAssetDesignerChatTemplate } from './planner-game-asset-designer-chat';
import { getPlannerGameAssetDesignerCodeTemplate } from './planner-game-asset-designer-code';
import { getPlannerResearcherChatTemplate } from './planner-researcher-chat';
import { getPlannerResearcherCodeTemplate } from './planner-researcher-code';
import { getPlannerReviewerChatTemplate } from './planner-reviewer-chat';
import { getPlannerReviewerCodeTemplate } from './planner-reviewer-code';
import { getPlannerTriageChatTemplate } from './planner-triage-chat';
import { getPlannerTriageCodeTemplate } from './planner-triage-code';
import { getPlannerUiuxEngineerChatTemplate } from './planner-uiux-engineer-chat';
import { getPlannerUiuxEngineerCodeTemplate } from './planner-uiux-engineer-code';
import { getPlannerUserChatTemplate } from './planner-user-chat';
import { getPlannerUserCodeTemplate } from './planner-user-code';
import { getPlannerVerifierChatTemplate } from './planner-verifier-chat';
import { getPlannerVerifierCodeTemplate } from './planner-verifier-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const duoPlannerHandoffContract = {
  role: 'planner',
  receivesFrom: [
    'user',
    'builder',
    'architect',
    'uiux-engineer',
    'triage',
    'researcher',
    'reviewer',
    'game-asset-designer',
    'verifier',
  ],
  returnsTo: [
    'user',
    'builder',
    'architect',
    'uiux-engineer',
    'triage',
    'researcher',
    'reviewer',
    'game-asset-designer',
    'verifier',
  ],
  outboundTemplates: {
    builder: handoffTemplateByMode({
      chat: getPlannerBuilderChatTemplate,
      code: getPlannerBuilderCodeTemplate,
    }),
    architect: handoffTemplateByMode({
      chat: getPlannerArchitectChatTemplate,
      code: getPlannerArchitectCodeTemplate,
    }),
    'uiux-engineer': handoffTemplateByMode({
      chat: getPlannerUiuxEngineerChatTemplate,
      code: getPlannerUiuxEngineerCodeTemplate,
    }),
    triage: handoffTemplateByMode({
      chat: getPlannerTriageChatTemplate,
      code: getPlannerTriageCodeTemplate,
    }),
    researcher: handoffTemplateByMode({
      chat: getPlannerResearcherChatTemplate,
      code: getPlannerResearcherCodeTemplate,
    }),
    reviewer: handoffTemplateByMode({
      chat: getPlannerReviewerChatTemplate,
      code: getPlannerReviewerCodeTemplate,
    }),
    'game-asset-designer': handoffTemplateByMode({
      chat: getPlannerGameAssetDesignerChatTemplate,
      code: getPlannerGameAssetDesignerCodeTemplate,
    }),
    verifier: handoffTemplateByMode({
      chat: getPlannerVerifierChatTemplate,
      code: getPlannerVerifierCodeTemplate,
    }),
    user: handoffTemplateByMode({
      chat: getPlannerUserChatTemplate,
      code: getPlannerUserCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'duo', 'planner'>;
