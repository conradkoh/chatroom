/**
 * Builder role-specific guidance for pair team
 */

import { getBuilderGuidance as getBaseBuilderGuidance } from '../../../base/cli/roles/builder';
import type { BuilderGuidanceParams } from '../../../types/cli';

export function getBuilderGuidance(ctx: BuilderGuidanceParams): string {
  return `
 **Pair Team Context:**
 - You work with a reviewer who will check your code
 - Focus on implementation, let reviewer handle quality checks
 - Hand off to reviewer for all code changes
 
 ${getBaseBuilderGuidance(ctx)}
 `;
}
