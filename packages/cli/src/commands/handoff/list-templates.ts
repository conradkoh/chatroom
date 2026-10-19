/**
 * Static local command: show the descriptor, send command, reply pair, and
 * rendered template for one sender → recipient pair.
 *
 * No authentication and no Convex call — the backend prompt module resolves
 * the pair against the role-owned catalog locally.
 */

import { listHandoffTemplatesCommand } from '@workspace/backend/prompts/cli/handoff-templates/list-templates.js';
import type { HandoffTemplatePairInput } from '@workspace/backend/prompts/cli/handoff-templates/pair.js';

export interface ListTemplatesOptions extends HandoffTemplatePairInput {
  cliEnvPrefix?: string | undefined;
}

export function printHandoffListTemplates(options: ListTemplatesOptions): void {
  try {
    console.log(listHandoffTemplatesCommand(options));
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
