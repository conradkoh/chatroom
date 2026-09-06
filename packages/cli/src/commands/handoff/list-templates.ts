/**
 * Static local command: list a role's handoff contract and renderable templates.
 *
 * No authentication and no Convex call — the backend prompt module resolves
 * the role-owned catalogue locally.
 */

import { listHandoffTemplatesCommand } from '@workspace/backend/prompts/cli/handoff-templates/list-templates.js';

export interface ListTemplatesOptions {
  role: string;
  teamId?: string | undefined;
  cliEnvPrefix?: string | undefined;
}

export function printHandoffListTemplates(options: ListTemplatesOptions): void {
  try {
    const output = listHandoffTemplatesCommand({
      role: options.role,
      teamId: options.teamId,
      cliEnvPrefix: options.cliEnvPrefix,
    });
    console.log(output);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
