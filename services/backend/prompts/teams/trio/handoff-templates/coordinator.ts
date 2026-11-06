/**
 * The trio coordinator owns all coordination; it never hands off to builder.
 *
 * The coordinator receives the user conversation and every returned brief, and
 * returns work to the user and to each specialist or the specifier. Each target
 * selects its key file by conversation mode through `handoffTemplateByMode`.
 */

import { getCoordinatorArchitectChatTemplate } from './coordinator-architect-chat';
import { getCoordinatorArchitectCodeTemplate } from './coordinator-architect-code';
import { getCoordinatorGameAssetDesignerChatTemplate } from './coordinator-game-asset-designer-chat';
import { getCoordinatorGameAssetDesignerCodeTemplate } from './coordinator-game-asset-designer-code';
import { getCoordinatorResearcherChatTemplate } from './coordinator-researcher-chat';
import { getCoordinatorResearcherCodeTemplate } from './coordinator-researcher-code';
import { getCoordinatorReviewerChatTemplate } from './coordinator-reviewer-chat';
import { getCoordinatorReviewerCodeTemplate } from './coordinator-reviewer-code';
import { getCoordinatorSpecifierChatTemplate } from './coordinator-specifier-chat';
import { getCoordinatorSpecifierCodeTemplate } from './coordinator-specifier-code';
import { getCoordinatorTriageChatTemplate } from './coordinator-triage-chat';
import { getCoordinatorTriageCodeTemplate } from './coordinator-triage-code';
import { getCoordinatorUiuxEngineerChatTemplate } from './coordinator-uiux-engineer-chat';
import { getCoordinatorUiuxEngineerCodeTemplate } from './coordinator-uiux-engineer-code';
import { getCoordinatorUserChatTemplate } from './coordinator-user-chat';
import { getCoordinatorUserCodeTemplate } from './coordinator-user-code';
import { getCoordinatorVerifierChatTemplate } from './coordinator-verifier-chat';
import { getCoordinatorVerifierCodeTemplate } from './coordinator-verifier-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioCoordinatorHandoffContract = {
  role: 'coordinator',
  receivesFrom: [
    'user',
    'specifier',
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
    'specifier',
    'architect',
    'uiux-engineer',
    'triage',
    'researcher',
    'reviewer',
    'game-asset-designer',
    'verifier',
  ],
  outboundTemplates: {
    user: handoffTemplateByMode({
      chat: getCoordinatorUserChatTemplate,
      code: getCoordinatorUserCodeTemplate,
    }),
    specifier: handoffTemplateByMode({
      chat: getCoordinatorSpecifierChatTemplate,
      code: getCoordinatorSpecifierCodeTemplate,
    }),
    architect: handoffTemplateByMode({
      chat: getCoordinatorArchitectChatTemplate,
      code: getCoordinatorArchitectCodeTemplate,
    }),
    'uiux-engineer': handoffTemplateByMode({
      chat: getCoordinatorUiuxEngineerChatTemplate,
      code: getCoordinatorUiuxEngineerCodeTemplate,
    }),
    triage: handoffTemplateByMode({
      chat: getCoordinatorTriageChatTemplate,
      code: getCoordinatorTriageCodeTemplate,
    }),
    researcher: handoffTemplateByMode({
      chat: getCoordinatorResearcherChatTemplate,
      code: getCoordinatorResearcherCodeTemplate,
    }),
    reviewer: handoffTemplateByMode({
      chat: getCoordinatorReviewerChatTemplate,
      code: getCoordinatorReviewerCodeTemplate,
    }),
    'game-asset-designer': handoffTemplateByMode({
      chat: getCoordinatorGameAssetDesignerChatTemplate,
      code: getCoordinatorGameAssetDesignerCodeTemplate,
    }),
    verifier: handoffTemplateByMode({
      chat: getCoordinatorVerifierChatTemplate,
      code: getCoordinatorVerifierCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'coordinator'>;
