/**
 * New feature classification guidance for CLI task-started command.
 */

import { HANDOFF_DIR } from '../../../../utils/config.js';
import { taskStartedCommand } from '../command.js';

/**
 * Generate new feature classification guidance
 */
export function getNewFeatureClassificationGuidance(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const { cliEnvPrefix } = ctx;

  // Inline metadata example
  const inlineCmd = taskStartedCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    title: 'Add user authentication',
    description: 'Implement JWT login/logout flow',
    techSpecs: 'Use bcrypt, 24h expiry, secure cookies',
    cliEnvPrefix,
  });

  // File-based metadata example (base command without file args)
  const fileBasedCmd = taskStartedCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    title: 'Add user authentication',
    cliEnvPrefix,
  });

  return `
### New Feature Classification

**When to use:** When the user wants new functionality, features, or significant code changes.

**Characteristics:**
- User is requesting something that doesn't exist yet
- Requires implementation of new code
- May involve multiple files or components
- Always requires review before delivery

**⚠️ REQUIRED METADATA:**
For \`new_feature\` classification, you MUST provide all three fields:
- \`--title\`: Clear, concise feature title
- \`--description\`: What the feature does and why it's needed
- \`--tech-specs\`: Technical implementation details

**Implementation Options:**

**Option 1: Inline Metadata (recommended for short descriptions)**
\`\`\`bash
${inlineCmd}
\`\`\`

**Option 2: File-based Metadata (recommended for complex features)**
\`\`\`bash
# Create description and tech specs files
mkdir -p ${HANDOFF_DIR}
DESC_FILE="${HANDOFF_DIR}/description-$(date +%s%N).md"
SPECS_FILE="${HANDOFF_DIR}/techspecs-$(date +%s%N).md"

# Write detailed content
cat > "$DESC_FILE" << 'EOF'
Implement JWT-based authentication with login/logout flow.
Users can securely authenticate and maintain session state.
EOF

cat > "$SPECS_FILE" << 'EOF'
- Use bcrypt for password hashing
- JWT tokens expire after 24h
- Store tokens in secure HTTP-only cookies
- Implement refresh token mechanism
EOF

# Run command with files
${fileBasedCmd} \\
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
1. Classify as \`new_feature\` with complete metadata (title, description, tech-specs)
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
