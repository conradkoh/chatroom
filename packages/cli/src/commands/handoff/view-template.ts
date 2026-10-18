/**
 * Static local command: print the handoff template for one sender → recipient
 * pair.
 *
 * Pair resolution and the exact error messages live in the backend pair
 * resolver; this wrapper only handles CLI output and exit status.
 */

import { viewHandoffTemplate } from '@workspace/backend/prompts/cli/handoff/view-template.js';
import type { HandoffTemplatePairInput } from '@workspace/backend/prompts/cli/handoff-templates/pair.js';

export type HandoffViewTemplateOptions = HandoffTemplatePairInput;

export function printHandoffViewTemplate(options: HandoffViewTemplateOptions): void {
  try {
    console.log(viewHandoffTemplate({ ...options, nativeIntegration: true }));
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
