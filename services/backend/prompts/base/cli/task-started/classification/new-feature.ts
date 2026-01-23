/**
 * New feature classification guidance for CLI task-started command.
 */

import { getHandoffFileSnippet } from '../../../shared/config.js';

/**
 * Generate new feature classification guidance
 */
export function getNewFeatureClassificationGuidance(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix?: string;
}): string {
  const prefix = ctx.cliEnvPrefix || '';

  return `
### New Feature Classification

**When to use:** When the user wants new functionality, features, or significant code changes.

**Characteristics:**
- User is requesting something that doesn't exist yet
- Requires implementation of new code
- May involve multiple files or components
- Always requires review before delivery

**Required Metadata:**
For \`new_feature\` classification, you MUST provide:
- \`--title\`: Clear, concise feature title
- \`--description\`: What the feature does and why it's needed
- \`--tech-specs\`: Technical implementation details

**Implementation Options:**

**Option 1: Inline Metadata (short descriptions)**
\`\`\`bash
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --origin-message-classification=new_feature \\
  --message-id=<messageId> \\
  --title="Add user authentication" \\
  --description="Implement JWT login/logout flow" \\
  --tech-specs="Use bcrypt, 24h expiry, secure cookies"
\`\`\`

**Option 2: File-based Metadata (recommended for complex features)**
\`\`\`bash
# Create description and tech specs files
${getHandoffFileSnippet('description')}
${getHandoffFileSnippet('techSpecs')}

# Write detailed content
echo "Implement JWT-based authentication with login/logout flow" > "$DESC_FILE"
echo "Use bcrypt for password hashing. JWT tokens expire after 24h" > "$SPECS_FILE"

# Run command with files
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --origin-message-classification=new_feature \\
  --message-id=<messageId> \\
  --title="Add user authentication" \\
  --description-file="$DESC_FILE" \\
  --tech-specs-file="$SPECS_FILE"
\`\`\`

**Examples:**
- "Add user authentication system"
- "Implement file upload functionality"
- "Create a real-time chat feature"
- "Build an admin dashboard"
- "Add email notifications"

**Workflow:**
1. Classify as \`new_feature\` with complete metadata
2. Implement the requested changes
3. Test the implementation
4. **MUST hand off to \`reviewer\`** (cannot skip review)
5. Address reviewer feedback if needed
6. Final approval and delivery

**Handoff Rules:**
- **ALWAYS** hand off to \`reviewer\` (no exceptions)
- Include implementation summary in handoff
- Provide testing instructions if applicable
- Note any assumptions or limitations
`;
}
