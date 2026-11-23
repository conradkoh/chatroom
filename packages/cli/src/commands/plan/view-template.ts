/**
 * Static local command: print the plan template. No auth, no chatroom.
 */

import { viewPlanTemplate } from '@workspace/backend/prompts/cli/plan/view-template.js';

export function printPlanViewTemplate(options: { cliEnvPrefix?: string | undefined } = {}): void {
  console.log(viewPlanTemplate({ nativeIntegration: true, cliEnvPrefix: options.cliEnvPrefix }));
}
