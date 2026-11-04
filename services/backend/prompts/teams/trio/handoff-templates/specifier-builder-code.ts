/**
 * Key: `trio:specifier->builder@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Specifier → builder delegation brief. Body only: the pair resolver prepends the
 * recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getBuilderDelegationBriefTemplate } from '../../builder-delegation-handoff-templates';

/** Code-bucket getter for the trio `specifier` → `builder` handoff. */
export function getSpecifierBuilderCodeTemplate(_query: HandoffTemplateQuery): string {
  return getBuilderDelegationBriefTemplate({
    delegatorRole: 'specifier',
    gatesOwner: 'coordinator',
  });
}
