/**
 * Task-started section for agent initialization prompts.
 * Explains the classification system and workflow.
 */

import type { InitPromptContext } from './base';

/**
 * Generate the task-started section
 */
export function getTaskStartedSection(ctx: InitPromptContext): string {
  const isBuilder = ctx.role.toLowerCase() === 'builder';
  const isReviewer = ctx.role.toLowerCase() === 'reviewer';

  let roleSpecificNote = '';
  if (isBuilder) {
    roleSpecificNote = `
**Important for Builders:**
- For \`new_feature\` requests, you CANNOT hand off directly to the user
- You MUST hand off to the reviewer first for review
- This ensures all new features are reviewed before delivery`;
  } else if (isReviewer) {
    roleSpecificNote = `
**Important for Reviewers:**
- After approving work, you can hand off to either builder (for revisions) or user (to complete)
- For \`question\` or \`follow_up\` tasks, you can hand directly to user`;
  }

  return `## Acknowledging Tasks (Classification)

When you receive a user message, you MUST first acknowledge it and classify what type of request it is:

\`\`\`bash
chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<type>
\`\`\`

### Classification Types

| Type | Description | Workflow |
|------|-------------|----------|
| \`question\` | User is asking a question | Can respond directly to user |
| \`new_feature\` | User wants new functionality built | Must go through review before returning to user |
| \`follow_up\` | User is following up on previous task | Same rules as the original task |

### Example

\`\`\`bash
# Acknowledge you're starting work on a new feature request
chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature

# Now do your work...

# When done, hand off appropriately based on classification
chatroom task-complete ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="<summary>" \\
  --next-role=${isBuilder ? 'reviewer' : 'user'}
\`\`\`
${roleSpecificNote}`;
}
