/**
 * Reviewer role-specific guidance for agent initialization prompts.
 */

import { HANDOFF_DIR, generateFilename } from '../../../utils/config.js';
import { handoffCommand } from '../handoff/command.js';
import { taskStartedCommand } from '../task-started/command.js';

/**
 * Generate reviewer-specific guidance
 */
export function getReviewerGuidance(otherRoles: string[]): string {
  const hasBuilder = otherRoles.some((r) => r.toLowerCase() === 'builder');

  // Use command generators with placeholders
  const taskStartedExample = taskStartedCommand({});

  // Generate unique filenames for different handoff scenarios
  const { varName: feedbackFileVar, filePath: feedbackFilePath } = generateFilename('feedback', {
    type: 'md',
  });
  const { varName: approvalFileVar, filePath: approvalFilePath } = generateFilename('approval', {
    type: 'md',
  });

  const feedbackHandoffCmd = handoffCommand({ nextRole: 'builder', messageFile: feedbackFilePath });
  const approvalHandoffCmd = handoffCommand({ nextRole: 'user', messageFile: approvalFilePath });

  return `
## Reviewer Workflow

You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it and classify what type of request it is:

**Important: DO run task-started** - Every message you receive needs to be classified, even handoffs.

**Typical Flow:**
1. Receive message (handoff from builder or other agent)
2. First run \`${taskStartedExample}\` to classify the original message
3. Review the code changes or content:
   - Check uncommitted changes: \`git status\`, \`git diff\`
   - Check recent commits: \`git log --oneline -10\`, \`git diff HEAD~N..HEAD\`
4. Either approve or request changes

**Your Options After Review:**

**If changes are needed:**
\`\`\`bash
# Set unique filename (evaluate once)
${feedbackFileVar}=$(date +%s%N)

# Create the handoff directory and write detailed feedback
mkdir -p ${HANDOFF_DIR}
cat > ${feedbackFilePath} << 'EOF'
## Issues Found

Please address:
1. [Issue one with details]
2. [Issue two with details]

## Suggestions
- [Specific recommendation]
EOF

# Hand back to builder
${feedbackHandoffCmd}
\`\`\`

**If work is approved:**
\`\`\`bash
# Set unique filename (evaluate once)
${approvalFileVar}=$(date +%s%N)

# Create the handoff directory and write approval message
mkdir -p ${HANDOFF_DIR}
cat > ${approvalFilePath} << 'EOF'
## APPROVED ✅

The code is clean, tests pass, and requirements are met.

## Summary
- [What was reviewed]
- [Key points verified]
EOF

# Hand off to user
${approvalHandoffCmd}
\`\`\`

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
