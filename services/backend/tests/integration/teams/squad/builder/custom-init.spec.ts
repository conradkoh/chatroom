/**
 * Squad Team — Builder Custom Agent Init Prompt
 *
 * Verifies the initialization prompt shown to custom agents in the webapp's
 * Custom tab for the builder role in a Squad team. This is the simplified
 * prompt from generateAgentPrompt (webapp display version).
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateAgentPrompt } from '../../../../../prompts/base/webapp/init/generator';

describe('Squad Team > Builder > Custom Init Prompt', () => {
  test('custom agent init prompt', () => {
    const prompt = generateAgentPrompt({
      chatroomId: 'test-squad-chatroom',
      role: 'builder',
      teamName: 'Squad',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamEntryPoint: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(prompt).toBeDefined();
    expect(prompt).toContain('# Squad Team');
    expect(prompt).toContain('## Your Role: BUILDER');
    expect(prompt).toContain('--type=custom');
    expect(prompt).toContain('## Team Roles');
    expect(prompt).toContain('## Next Steps');

    expect(prompt).toMatchInlineSnapshot(`
      "# Squad Team

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
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id=test-squad-chatroom --role=builder --type=custom
      \`\`\`

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-squad-chatroom --role=builder
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-squad-chatroom --role=builder
      \`\`\`

      **Squad Team Context:**
       - You work with a planner who coordinates the team and communicates with the user
       - You do NOT communicate directly with the user — hand off to the planner instead
       - Focus on implementation, the planner or reviewer will handle quality checks
       - After completing work, hand off to reviewer (if available) or planner
       - **NEVER hand off directly to \`user\`** — always go through the planner

      ## Team Roles

      planner, builder, reviewer

      ## Handoff Options

      Available targets: planner, reviewer

      > **Note:** In squad team, only the planner can hand off to the user.

      ## Next Steps

      1. Run the **register-agent** command above to register your agent type
      2. Copy the **context read** command to review conversation history
      3. Run **wait-for-task** to receive your first task
      4. Follow the detailed instructions provided by the CLI
      "
    `);
  });
});
