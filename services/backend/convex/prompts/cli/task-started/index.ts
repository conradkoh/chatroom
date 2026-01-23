/**
 * CLI-specific prompts for the task-started command
 */

import { getHandoffFileSnippet } from '../../config';

/**
 * Generate the main CLI prompt for task-started command
 */
export function getTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix?: string;
}): string {
  const prefix = ctx.cliEnvPrefix || '';

  return `
## Task Classification

When you receive a user message, you MUST first acknowledge it and classify what type of request it is:

\`\`\`bash
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=<type> --message-id=<messageId>
\`\`\`

### Classification Types

| Type | Description | When to Use |
|------|-------------|-------------|
| **question** | User needs clarification or has a question | When user is asking for information |
| **new_feature** | User wants new functionality implemented | When user requests new features |
| **follow_up** | User is responding to previous work | When user provides feedback or additional requirements |

### New Feature Classification

For **new_feature** classification, you must provide additional details:

\`\`\`bash
# Create description and tech specs files
${getHandoffFileSnippet('description')}
${getHandoffFileSnippet('techSpecs')}

# Then run task-started with metadata
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --title="Feature title" \\
  --description-file="$DESC_FILE" \\
  --tech-specs-file="$SPECS_FILE"
\`\`\`

**Example:**
\`\`\`bash
# Create files
echo "Implement JWT-based authentication with login/logout flow" > "$DESC_FILE"
echo "Use bcrypt for password hashing. JWT tokens expire after 24h." > "$SPECS_FILE"

# Run command
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --title="Add user authentication" \\
  --description-file="$DESC_FILE" \\
  --tech-specs-file="$SPECS_FILE"
\`\`\`

### Important Notes

- **Always use --message-id**: You must specify the exact message ID to classify
- **One message per task-started**: Each command classifies exactly one message
- **Classification determines workflow**: Your classification affects available handoff options
- **Feature metadata required**: For new_feature, title, description, and tech specs are mandatory

### After Classification

Once you run \`task-started\`, you'll receive a focused reminder with specific next steps based on your role and classification type.
`;
}

/**
 * Generate usage examples for task-started
 */
export function getTaskStartedExamples(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix?: string;
}): string {
  const prefix = ctx.cliEnvPrefix || '';

  return `
## Task-Started Examples

### Basic Classification
\`\`\`bash
# Classify a question
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=question --message-id=<messageId>

# Classify a follow_up
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=follow_up --message-id=<messageId>
\`\`\`

### New Feature Classification
\`\`\`bash
# With inline metadata (short descriptions)
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --message-id=<messageId> \\
  --title="Add user authentication" \\
  --description="Implement JWT login/logout" \\
  --tech-specs="Use bcrypt, 24h expiry"

# With file-based metadata (recommended for long descriptions)
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --message-id=<messageId> \\
  --title="Add user authentication" \\
  --description-file="feature-desc.md" \\
  --tech-specs-file="tech-specs.md"
\`\`\`

### Error Handling
\`\`\`bash
# Missing required fields (new_feature)
❌ Missing required fields: title, description, techSpecs
# Example:
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature --message-id=<messageId> \\
  --title="Feature title" \\
  --description="What this feature does" \\
  --tech-specs="How to implement it"

# Invalid message ID
❌ Message with ID "invalid_id" not found in this chatroom
# Verify the message ID is correct and you have access to this chatroom
\`\`\`
`;
}

/**
 * Generate validation and error messages for task-started
 */
export function getTaskStartedValidation(): string {
  return `
## Task-Started Validation

### Required Parameters
- \`--chatroomId\`: The chatroom ID (positional argument)
- \`--role\`: Your role (builder, reviewer, etc.)
- \`--classification\`: Message type (question, new_feature, follow_up)
- \`--message-id\`: The specific message ID to classify

### Conditional Requirements
For \`--classification=new_feature\`, you must also provide:
- \`--title\`: Feature title (required)
- \`--description\`: Feature description (required)
- \`--tech-specs\`: Technical specifications (required)

### Validation Rules
1. **Message ID must exist**: The message must be in the specified chatroom
2. **Message must be unclassified**: Cannot re-classify already classified messages
3. **Message must be from user**: Can only classify user messages, not agent messages
4. **Complete metadata**: All required fields must be present for new_feature

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|--------|----------|
| "Message not found" | Invalid message ID | Use \`wait-for-task\` to get correct message ID |
| "Already classified" | Message was already classified | Use a different, unclassified message |
| "Can only classify user messages" | Trying to classify agent message | Only user messages can be classified |
| "Missing required fields" | Incomplete new_feature metadata | Provide title, description, and tech-specs |
`;
}
