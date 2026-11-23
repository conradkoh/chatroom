/**
 * Builder role-specific guidance for agent initialization prompts.
 */

import { getSessionContinuityLine } from '../../native/session-continuity';
import type { BuilderGuidanceParams } from '../../types/cli';
import {
  getHandoffTemplateDiscoveryGuidance,
  getInterRoleHandoffRule,
  getUserHandoffVisibilityNote,
} from '../sections';

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
  const { questionTarget: questionTargetParam, codeChangesTarget, nativeIntegration } = params;
  const questionTarget = questionTargetParam ?? 'user';
  const discoveryGuidance = getHandoffTemplateDiscoveryGuidance({
    teamId: params.teamId ?? 'duo',
    role: 'builder',
    nativeIntegration,
  });

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
- **When the task needs no code changes (a question or information request)** → Hand off directly to \`${questionTarget}\`
  ⚠️ When \`${questionTarget}\` is the user: ${getUserHandoffVisibilityNote()}
${getInterRoleHandoffRule()}

${discoveryGuidance ? `${discoveryGuidance}\n\n` : ''}**Implementation Guidelines:**
- For UI implementation, first write a snapshot test that renders the component with the UI/UX engineer's target markup, classes, and styles as the expected output. Run it and confirm it fails, then implement the components until it passes. Do not update the expected snapshot to accept different markup.
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices from the codebase
- Handle edge cases and error scenarios
- Commit work with descriptive, atomic commit messages
- Verification follows the brief's \`## Verification flags\`: always run typecheck and lint; run each other kind the brief marks \`required\` with its listed command; do not run a broader scope than the brief asks for. Record every run, every \`not run\`, and every \`not applicable\` kind in your hand-back

**Completion gates (before PR or handoff):**
- All **(Required)** files done; verified as the brief's \`## Verification flags\` require: every \`required\` kind ran with its listed command, and typecheck and lint always ran. The feature works end-to-end as the brief's Requirements name it (a CLI run, an API call, a UI action, or the template render); when the brief marks \`e2e\` \`not applicable\`, the alternative evidence those Requirements name is the end-to-end check
- If blocked → ## Blockers / questions to ${codeChangesTarget}. No PR or \`mark-for-review\` until gates pass — unless the user explicitly requested a draft or incremental PR
`;
}
