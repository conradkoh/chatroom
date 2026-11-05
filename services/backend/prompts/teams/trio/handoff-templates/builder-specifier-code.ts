/**
 * Key: `trio:builder->specifier@code` (bucket `code`).
 * Builder → specifier work-complete/blocked handback. Body only: the pair resolver
 * prepends the recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { getBuilderHandbackTemplate } from '../../builder-handback-handoff-templates';

/** Code-bucket getter for the trio `builder` → `specifier` handoff. */
export function getBuilderSpecifierCodeTemplate(query: HandoffTemplateQuery): string {
  return getBuilderHandbackTemplate(query);
}
