/**
 * Trio specifier role-owned handoff contract.
 *
 * The specifier receives work packages from the coordinator and handbacks from
 * the builder. It returns one slice report per session to the coordinator (its upstream,
 * listed first) and work to the builder.
 */

import { getSpecifierBuilderChatTemplate } from './specifier-builder-chat';
import { getSpecifierBuilderCodeTemplate } from './specifier-builder-code';
import { getSpecifierCoordinatorChatTemplate } from './specifier-coordinator-chat';
import { getSpecifierCoordinatorCodeTemplate } from './specifier-coordinator-code';
import {
  handoffTemplateByMode,
  type BuiltinTeamRoleHandoffContract,
} from '../../../cli/handoff-templates/contracts';

export const trioSpecifierHandoffContract = {
  role: 'specifier',
  receivesFrom: ['coordinator', 'builder'],
  returnsTo: ['coordinator', 'builder'],
  outboundTemplates: {
    coordinator: handoffTemplateByMode({
      chat: getSpecifierCoordinatorChatTemplate,
      code: getSpecifierCoordinatorCodeTemplate,
    }),
    builder: handoffTemplateByMode({
      chat: getSpecifierBuilderChatTemplate,
      code: getSpecifierBuilderCodeTemplate,
    }),
  },
} as const satisfies BuiltinTeamRoleHandoffContract<'trio', 'specifier'>;
