/**
 * Builder role-specific guidance for pair team
 */

import { getBuilderGuidance as getBaseBuilderGuidance } from '../../../base/roles/builder.js';

export function getBuilderGuidance(ctx: {
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
}): string {
  const hasReviewer = ctx.teamRoles.some((r) => r.toLowerCase() === 'reviewer');

  return `
 ## Builder Workflow
 
 You are the implementer responsible for writing code and building solutions.
 
 **Pair Team Context:**
 - You work with a reviewer who will check your code
 - Focus on implementation, let reviewer handle quality checks
 - Hand off to reviewer for all code changes
 
 ${getBaseBuilderGuidance(ctx.isEntryPoint)}
 
 **Pair Team Handoff Rules:**
 - **After code changes** → Hand off to reviewer
 - **For simple questions** → Can hand off directly to user
 - **For new_feature classification** → MUST hand off to reviewer (cannot skip review)
 
 ${hasReviewer ? '' : ''}`;
}
