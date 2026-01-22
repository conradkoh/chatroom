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

### New Feature Classification

When classifying a message as \`new_feature\`, you MUST provide metadata via files:

\`\`\`bash
# Write description and tech specs to files with unique IDs
mkdir -p .chatroom/tmp/handoff
UNIQUE_ID=$(date +%s%N)
echo "Implement JWT-based authentication with login/logout flow" > ".chatroom/tmp/handoff/description-$UNIQUE_ID.md"
echo "Use bcrypt for password hashing. JWT tokens expire after 24h." > ".chatroom/tmp/handoff/tech-specs-$UNIQUE_ID.md"

chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --title="Add user authentication" \\
  --description-file=".chatroom/tmp/handoff/description-$UNIQUE_ID.md" \\
  --tech-specs-file=".chatroom/tmp/handoff/tech-specs-$UNIQUE_ID.md"
\`\`\`

**Format Requirements:**
- \`--title\`: Plain text only (no markdown)
- \`--description-file\`: Path to file with markdown formatted description
- \`--tech-specs-file\`: Path to file with markdown formatted technical specifications

### Example

\`\`\`bash
# Write your handoff message to a file with unique ID
mkdir -p .chatroom/tmp/handoff
MSG_FILE=".chatroom/tmp/handoff/message-$(date +%s%N).md"
echo "## Implementation Complete

Added user authentication with:
- JWT tokens
- Password hashing
- Session management" > "$MSG_FILE"

# Hand off to next role
chatroom handoff ${ctx.chatroomId} \\
  --role=${ctx.role} \\
  --message-file="$MSG_FILE" \\
  --next-role=${isBuilder ? 'reviewer' : 'user'}
\`\`\`

**Note:** All content is passed via files to avoid shell escape sequence issues.
${roleSpecificNote}`;
}
