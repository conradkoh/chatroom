/**
 * CLI-specific prompts for the task-started command
 */

import { getClassificationGuidance } from './classification/index.js';
import { taskStartedCommand } from './command.js';
import { getTaskStartedPrompt } from './main-prompt.js';

/**
 * Generate usage examples for task-started
 */
export function getTaskStartedExamples(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix?: string;
}): string {
  const cmdCtx = { cliEnvPrefix: ctx.cliEnvPrefix };

  // Commands with actual chatroomId/role but placeholder taskId
  const questionCmd = taskStartedCommand({
    type: 'command',
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'question',
    ...cmdCtx,
  });

  const followUpCmd = taskStartedCommand({
    type: 'command',
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'follow_up',
    ...cmdCtx,
  });

  const newFeatureInlineCmd = taskStartedCommand({
    type: 'command',
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    title: 'Add user authentication',
    description: 'Implement JWT login/logout',
    techSpecs: 'Use bcrypt, 24h expiry',
    ...cmdCtx,
  });

  const newFeatureFileCmd = taskStartedCommand({
    type: 'command',
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    title: 'Add user authentication',
    ...cmdCtx,
  });

  const errorExampleCmd = taskStartedCommand({
    type: 'command',
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    title: 'Feature title',
    description: 'What this feature does',
    techSpecs: 'How to implement it',
    ...cmdCtx,
  });

  return `
## Task-Started Examples

### Basic Classification
\`\`\`bash
# Classify a question
${questionCmd}

# Classify a follow_up
${followUpCmd}
\`\`\`

### New Feature Classification
\`\`\`bash
# With inline metadata (short descriptions)
${newFeatureInlineCmd}

# With file-based metadata (recommended for long descriptions)
${newFeatureFileCmd} \\
  --description-file="feature-desc.md" \\
  --tech-specs-file="tech-specs.md"
\`\`\`

### Error Handling
\`\`\`bash
# Missing required fields (new_feature)
❌ Missing required fields: title, description, techSpecs
# Example:
${errorExampleCmd}

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
- \`<chatroom-id>\`: The chatroom ID (positional argument)
- \`--role\`: Your role (builder, reviewer, etc.)
- \`--task-id\`: The specific task ID to acknowledge
- \`--origin-message-classification\`: Original message type (question, new_feature, follow_up)

### Conditional Requirements
For \`--origin-message-classification=new_feature\`, you must also provide:
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
export { getTaskStartedPrompt, getClassificationGuidance, taskStartedCommand };
