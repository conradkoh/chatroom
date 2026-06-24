/**
 * Builder role-specific guidance for agent initialization prompts.
 */

import { getSessionContinuityLine } from '../../native/session-continuity';
import type { BuilderGuidanceParams } from '../../types/cli';

function getBuilderFlowMermaid(
  nativeIntegration: boolean | undefined,
  codeChangesTarget: string,
  questionTarget: string
): string {
  const handoffNodes = `    D --> E[Commit work]
    E --> F{Code changes?}
    F -->|yes| G[Hand off to **${codeChangesTarget}**]
    F -->|no| H[Hand off to **${questionTarget}**]`;

  if (nativeIntegration) {
    return `flowchart TD
    A([Start]) --> B[Receive task]
    B --> D[Implement changes]
${handoffNodes}`;
  }

  return `flowchart TD
    A([Start]) --> B[Receive chatroom task]
    B --> D[Implement changes]
${handoffNodes}`;
}

/**
 * Generate builder-specific guidance
 */
export function getBuilderGuidance(params: BuilderGuidanceParams): string {
  const {
    questionTarget: questionTargetParam,
    codeChangesTarget: codeChangesTargetParam,
    nativeIntegration,
  } = params;
  const questionTarget = questionTargetParam ?? 'user';
  const codeChangesTarget = codeChangesTargetParam ?? 'planner';

  return `
## Builder Operating Model

${getSessionContinuityLine(nativeIntegration)}

You are responsible for implementing code changes based on requirements.

**Typical Flow:**

\`\`\`mermaid
${getBuilderFlowMermaid(nativeIntegration, codeChangesTarget, questionTarget)}
\`\`\`

**Handoff Rules:**
- **After code changes** → Hand off to \`${codeChangesTarget}\`
- **For simple questions** → Can hand off directly to \`${questionTarget}\`
  ⚠️ If \`${questionTarget}\` is the user: the user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a complete, self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation.

**Implementation Guidelines:**
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices from the codebase
- Handle edge cases and error scenarios
- Verify your work with \`pnpm typecheck && pnpm test\` before handing off
- Commit work with descriptive, atomic commit messages
`;
}
