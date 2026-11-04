/**
 * Trio builder role-owned handoff contract.
 *
 * The trio builder receives briefs from the specifier and returns work to the
 * specifier only.
 */

import { getBuilderSpecifierChatTemplate } from './builder-specifier-chat';
import { getBuilderSpecifierCodeTemplate } from './builder-specifier-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioBuilderHandoffContract = {
  role: 'builder',
  receivesFrom: ['specifier'],
  returnsTo: ['specifier'],
  outboundTemplates: {
    specifier: handoffTemplateByMode({
      chat: getBuilderSpecifierChatTemplate,
      code: getBuilderSpecifierCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'builder'>;
