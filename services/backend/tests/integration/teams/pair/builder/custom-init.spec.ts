/**
 * Pair Team — Builder Custom Agent Init Prompt
 *
 * Verifies the initialization prompt shown to custom agents in the webapp's
 * Custom tab for the builder role in a Pair team. This is the simplified
 * prompt from generateAgentPrompt (webapp display version).
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateAgentPrompt } from '../../../../../prompts/base/webapp/init/generator';

describe('Pair Team > Builder > Custom Init Prompt', () => {
  test('custom agent init prompt', () => {
    const prompt = generateAgentPrompt({
      chatroomId: 'test-pair-chatroom',
      role: 'builder',
      teamName: 'Pair',
      teamRoles: ['builder', 'reviewer'],
      teamEntryPoint: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(prompt).toBeDefined();
    expect(prompt).toContain('# Pair Team');
    expect(prompt).toContain('## Your Role: BUILDER');
    expect(prompt).toContain('--type=custom');
    expect(prompt).toContain('## Team Roles');
    expect(prompt).toContain('## Next Steps');

    expect(prompt).toMatchInlineSnapshot(`
      "# Pair Team

      ## Your Role: BUILDER

      You are the implementer responsible for writing code and building solutions.

      **Responsibilities:**
      - Implement solutions based on requirements or architect's design
      - Write clean, maintainable, well-documented code
      - Follow established patterns and best practices
      - Handle edge cases and error scenarios
      - Provide clear summaries of what was built

      ## Getting Started

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id=test-pair-chatroom --role=builder --type=custom
      \`\`\`

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-pair-chatroom --role=builder
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-pair-chatroom --role=builder
      \`\`\`

      ## Team Roles

      builder, reviewer

      ## Next Steps

      1. Run the **register-agent** command above to register your agent type
      2. Copy the **context read** command to review conversation history
      3. Run **wait-for-task** to receive your first task
      4. Follow the detailed instructions provided by the CLI
      "
    `);
  });
});
