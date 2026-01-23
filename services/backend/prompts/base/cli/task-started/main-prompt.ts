/**
 * Main CLI prompt for the task-started command.
 */

import { getClassificationGuidance } from './classification/index.js';
import { taskStartedCommand } from './command.js';

/**
 * Generate the main CLI prompt for task-started command
 */
export function getTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix?: string;
}): string {
  // Use command generator with placeholders
  const exampleCmd = taskStartedCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'question', // Placeholder shown with all options below
    cliEnvPrefix: ctx.cliEnvPrefix,
  });

  // Show format with classification options
  const cmdFormat = exampleCmd.replace(
    '--origin-message-classification=question',
    '--origin-message-classification=<question|new_feature|follow_up>'
  );

  return `
## Task Classification

When you receive a user message, you MUST first acknowledge it and classify what type of request it is:

\`\`\`bash
${cmdFormat}
\`\`\`

### Classification Types

| Type | Description | When to Use | Required Fields |
|------|-------------|-------------|-----------------|
| **question** | User needs clarification or has a question | When user is asking for information | task-id, classification |
| **new_feature** | User wants new functionality implemented | When user requests new features | task-id, classification, **title**, **description**, **tech-specs** |
| **follow_up** | User is responding to previous work | When user provides feedback or additional requirements | task-id, classification |

⚠️ **IMPORTANT**: \`new_feature\` classification requires three additional fields:
- \`--title\`: Clear, concise feature title
- \`--description\`: What the feature does and why it's needed  
- \`--tech-specs\`: Technical implementation details

${getClassificationGuidance('question')}

${getClassificationGuidance('new_feature', ctx)}

${getClassificationGuidance('follow_up')}

### Important Notes

- **Always use --task-id**: You must specify the exact task ID to acknowledge
- **One task per task-started**: Each command acknowledges exactly one task
- **Origin message classification determines workflow**: Your classification affects available handoff options
- **Feature metadata required**: For new_feature, title, description, and tech specs are mandatory

### After Classification

Once you run \`task-started\`, you'll receive a focused reminder with specific next steps based on your role and classification type.
`;
}
