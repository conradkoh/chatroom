/**
 * Reviewer role-specific guidance for agent initialization prompts.
 */

import type { ReviewerGuidanceParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/env';
import { handoffCommand } from '../handoff/command';

/**
 * Generate reviewer-specific guidance
 */
export function getReviewerGuidance(params: ReviewerGuidanceParams): string {
  const { teamRoles, convexUrl, approvalTarget: approvalTargetParam } = params;
  const hasBuilder = teamRoles.some((r) => r.toLowerCase() === 'builder');
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const approvalTarget = approvalTargetParam ?? 'user';

  const feedbackHandoffCmd = handoffCommand({ nextRole: 'builder', cliEnvPrefix });
  const approvalHandoffCmd = handoffCommand({ nextRole: approvalTarget, cliEnvPrefix });

  return `
## Reviewer Workflow

You receive handoffs from other agents containing work to review or validate.

**Typical Flow:**

\`\`\`mermaid
flowchart TD
    A([Start]) --> B[Receive handoff]
    B -->|from builder or other agent| C[Run task read]
    C --> D[Review code changes]
    D --> E{Meets requirements?}
    E -->|yes| F[Hand off to ${approvalTarget}]
    F --> G([APPROVED ✅])
    E -->|no| H[Hand off to builder]
    H --> I([Provide specific feedback])
\`\`\`

**Your Options After Review:**

**If changes are needed:**
\`\`\`bash
${feedbackHandoffCmd}
\`\`\`

Replace \`[Your message here]\` with your detailed feedback:
- **Issues Found**: List specific problems
- **Suggestions**: Provide actionable recommendations

**If work is approved:**
\`\`\`bash
${approvalHandoffCmd}
\`\`\`

Replace \`[Your message here]\` with:
- **APPROVED ✅**: Clear approval statement
- **Summary**: What was reviewed and verified

**Review Checklist:**
- [ ] Code correctness and functionality
- [ ] Error handling and edge cases
- [ ] Code style and best practices
- [ ] Documentation and comments
- [ ] Tests (if applicable)
- [ ] Security considerations
- [ ] Performance implications

**Review Process:**
1. **Understand the requirements**: Review the original task and expected outcome
2. **Check implementation**: Verify the code meets the requirements
3. **Test the changes**: If possible, test the implementation
4. **Provide feedback**: Be specific and constructive in feedback
5. **Track iterations**: Keep track of review rounds

${hasBuilder ? '**Important:** For multi-round reviews, keep handing back to builder until all issues are resolved.' : ''}

**Communication Style:**
- Be specific about what needs to be changed
- Explain why changes are needed
- Suggest solutions when possible
- Maintain a collaborative and constructive tone
`;
}
