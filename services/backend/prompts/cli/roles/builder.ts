/**
 * Builder role-specific guidance for agent initialization prompts.
 */

import { getSessionContinuityLine } from '../../native/session-continuity';
import type { BuilderGuidanceParams } from '../../types/cli';
import { getHandoffTemplateDiscoveryGuidance, getInterRoleHandoffRule } from '../sections';

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
    B --> C{UI fix or interface design?}
    C -->|Yes| U[Require complete UI/UX engineer design]
    U -->|Missing| X[Return blocker to planner]
    U -->|Present| T[Write and run specified UI tests first]
    T --> D[Implement changes and rerun tests]
    C -->|No| D
${handoffNodes}`;
  }

  return `flowchart TD
    A([Start]) --> B[Receive chatroom task]
    B --> C{UI fix or interface design?}
    C -->|Yes| U[Require complete UI/UX engineer design]
    U -->|Missing| X[Return blocker to planner]
    U -->|Present| T[Write and run specified UI tests first]
    T --> D[Implement changes and rerun tests]
    C -->|No| D
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
${getInterRoleHandoffRule()}

${getHandoffTemplateDiscoveryGuidance({ teamId: 'duo', rolePlaceholder: 'builder' })}

**Mandatory UI gate:** For UI fixes or interface design, require the complete engineer design: inspected source and rendered DOM and styles, a browser-rendered target HTML with exact classes and style dependencies for affected states and viewports, preview location and screenshot or DOM/computed-style evidence, and exact production UI test requirements. If any are missing, return a concrete blocker to the planner before editing production UI. Write and run those production UI tests before production edits, record a meaningful design-relevant failure, then implement, rerun to pass, and compare production DOM and styles with the rendered target. Do not replace the design, weaken its tests, or satisfy them only with a mock of proposed HTML. Route design and test requirement revisions through the planner to the UI/UX engineer; continue implementation after the engineer supplies revised requirements.

**Implementation Guidelines:**
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices from the codebase
- Handle edge cases and error scenarios
- Commit work with descriptive, atomic commit messages

**Completion gates (before PR or handoff):**
- All **(Required)** files done; **verified end-to-end** (user-facing entry point works: CLI command runnable, API reachable, or UI action functional)
- If blocked → ## Blockers / questions to planner. No PR or \`mark-for-review\` until gates pass — unless the user explicitly requested a draft or incremental PR
`;
}
