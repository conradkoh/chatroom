/**
 * Builder role-specific guidance for agent initialization prompts.
 */

import type { BuilderGuidanceParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/env';
import { taskStartedCommand } from '../task-started/command';

/**
 * Generate builder-specific guidance
 */
export function getBuilderGuidance(params: BuilderGuidanceParams): string {
  const { isEntryPoint, convexUrl, questionTarget: questionTargetParam, codeChangesTarget: codeChangesTargetParam } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const questionTarget = questionTargetParam ?? 'user';
  const codeChangesTarget = codeChangesTargetParam ?? 'reviewer';
  const hasReviewer = codeChangesTarget === 'reviewer';
  // Use command generator with env prefix
  const taskStartedExample = taskStartedCommand({ cliEnvPrefix });

  const classificationNote = isEntryPoint
    ? `
**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:
1. First run \`${cliEnvPrefix}chatroom task read --chatroom-id="<chatroom-id>" --role="<role>" --task-id="<task-id>"\` to get the task content (auto-marks as in_progress)
2. Then run \`${taskStartedExample}\` to classify the original message (question, new_feature, or follow_up)
3. Then do your work
4. Hand off to ${codeChangesTarget} for code changes, or directly to ${questionTarget} for questions`
    : '';

  return `
## Builder Workflow

You are responsible for implementing code changes based on requirements.
${classificationNote}

**Typical Flow:**

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive task\nThen read it]
    ${hasReviewer ? 'B -->|from user or reviewer| C[Implement changes]' : 'B -->|from planner| C[Implement changes]'}
    C --> D[Commit work]
    D --> E{Classification?}
    E -->|new_feature or code changes| F[Hand off to **${codeChangesTarget}**]
    E -->|question| G[Hand off to **${questionTarget}**]
\`\`\`

**Handoff Rules:**
- **After code changes** → Hand off to \`${codeChangesTarget}\`
- **For simple questions** → Can hand off directly to \`${questionTarget}\`
- **For \`new_feature\` classification** → MUST hand off to \`${codeChangesTarget}\` (cannot skip ${hasReviewer ? 'review' : 'planner'})
${hasReviewer ? `
**When you receive handoffs from the reviewer:**
You will receive feedback on your code. Review the feedback, make the requested changes, and hand back to the reviewer.
` : ''}
**Development Best Practices:**
- Write clean, maintainable code
- Add appropriate tests when applicable
- Document complex logic
- Follow existing code patterns and conventions
- Consider edge cases and error handling

**Git Workflow:**
- Use descriptive commit messages
- Create logical commits (one feature/change per commit)
- Keep the working directory clean between commits
- Use \`git status\`, \`git diff\` to review changes before committing
`;
}
