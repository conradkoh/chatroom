/**
 * CLI-specific prompts for the task-started command
 */

import { getClassificationGuidance } from './classification';
import { getTaskStartedPrompt } from './main-prompt';

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
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=question --task-id=<taskId>

# Classify a follow_up
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=follow_up --task-id=<taskId>
\`\`\`

### New Feature Classification
\`\`\`bash
# With inline metadata (short descriptions)
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --task-id=<taskId> \\
  --title="Add user authentication" \\
  --description="Implement JWT login/logout" \\
  --tech-specs="Use bcrypt, 24h expiry"

# With file-based metadata (recommended for long descriptions)
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature \\
  --task-id=<taskId> \\
  --title="Add user authentication" \\
  --description-file="feature-desc.md" \\
  --tech-specs-file="tech-specs.md"
\`\`\`

### Error Handling
\`\`\`bash
# Missing required fields (new_feature)
❌ Missing required fields: title, description, techSpecs
# Example:
${prefix}chatroom task-started ${ctx.chatroomId} --role=${ctx.role} --classification=new_feature --task-id=<taskId> \\
  --title="Feature title" \\
  --description="What this feature does" \\
  --tech-specs="How to implement it"

# Invalid task ID
❌ Task with ID "invalid_id" not found in this chatroom
# Verify the task ID is correct and you have access to this chatroom
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
- \`--task-id\`: The specific task ID to acknowledge

### Conditional Requirements
For \`--classification=new_feature\`, you must also provide:
- \`--title\`: Feature title (required)
- \`--description\`: Feature description (required)
- \`--tech-specs\`: Technical specifications (required)

### Validation Rules
1. **Task ID must exist**: The task must be in the specified chatroom
2. **Task must have associated message**: Task must be linked to a message
3. **Classification rules**: User messages can be classified; handoff messages are acknowledged
4. **Complete metadata**: All required fields must be present for new_feature

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|--------|----------|
| "Task not found" | Invalid task ID | Use \`wait-for-task\` to get correct task ID |
| "Associated message not found" | Task not linked to message | Ensure task was created properly |
| "Cannot classify user messages" | Wrong task type | Only new tasks can be classified |
| "Missing required fields" | Incomplete new_feature metadata | Provide title, description, and tech-specs |
`;
}

// Re-export main functions
export { getTaskStartedPrompt, getClassificationGuidance };
