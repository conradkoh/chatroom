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
${ctx.cliEnvPrefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<type>
\`\`\`

### Classification Types

| Type | Description | Workflow |
|------|-------------|----------|
| \`question\` | User is asking a question | Can respond directly to user |
| \`new_feature\` | User wants new functionality built | Must go through review before returning to user |
| \`follow_up\` | User is following up on previous task | Same rules as the original task |

### New Feature Classification

When classifying a message as \`new_feature\`, you MUST provide metadata:

\`\`\`bash
${ctx.cliEnvPrefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --title="<plain text title>" \\
  --description="<markdown formatted description>" \\
  --tech-specs="<markdown formatted technical specifications>"
\`\`\`

**Format Requirements:**
- \`--title\`: Plain text only (no markdown)
- \`--description\`: Markdown formatted
- \`--tech-specs\`: Markdown formatted

### Example

\`\`\`bash
# Acknowledge you're starting work on a new feature request
${ctx.cliEnvPrefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --title="Add user authentication" \\
  --description="Implement JWT-based authentication with login/logout flow" \\
  --tech-specs="Use bcrypt for password hashing. JWT tokens expire after 24h."

# Now do your work...

# When done, hand off appropriately based on classification
${ctx.cliEnvPrefix}chatroom handoff ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message="<markdown formatted summary>" \\
  --next-role=${isBuilder ? 'reviewer' : 'user'}
\`\`\`

**Note:** For multiline content in description/tech-specs, use markdown formatting within the string (e.g., bullet points with \`- item\` or numbered lists with \`1. item\`). The content will be rendered as markdown in the UI.
${roleSpecificNote}`;
}
