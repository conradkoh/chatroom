/**
 * Main CLI prompt for the task-started command.
 */

import { getClassificationGuidance } from './classification';

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

${getClassificationGuidance('question')}

${getClassificationGuidance('new_feature', ctx)}

${getClassificationGuidance('follow_up')}

### Important Notes

- **Always use --message-id**: You must specify the exact message ID to classify
- **One message per task-started**: Each command classifies exactly one message
- **Classification determines workflow**: Your classification affects available handoff options
- **Feature metadata required**: For new_feature, title, description, and tech specs are mandatory

### After Classification

Once you run \`task-started\`, you'll receive a focused reminder with specific next steps based on your role and classification type.
`;
}
