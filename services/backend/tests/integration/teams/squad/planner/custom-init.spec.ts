/**
 * Squad Team — Planner Custom Agent Init Prompt
 *
 * Verifies the initialization prompt shown to custom agents in the webapp's
 * Custom tab for the planner role in a Squad team. This is the simplified
 * prompt from generateAgentPrompt (webapp display version).
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateAgentPrompt } from '../../../../../prompts/base/webapp/init/generator';

describe('Squad Team > Planner > Custom Init Prompt', () => {
  test('custom agent init prompt', () => {
    const prompt = generateAgentPrompt({
      chatroomId: 'test-squad-chatroom',
      role: 'planner',
      teamName: 'Squad',
      teamRoles: ['planner', 'builder', 'reviewer'],
      teamEntryPoint: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(prompt).toBeDefined();
    expect(prompt).toContain('# Squad Team');
    expect(prompt).toContain('## Your Role: PLANNER');
    expect(prompt).toContain('--type=custom');
    expect(prompt).toContain('## Team Roles');
    expect(prompt).toContain('planner, builder, reviewer');
    expect(prompt).toContain('## Next Steps');

    expect(prompt).toMatchInlineSnapshot(`
      "# Squad Team

      ## Your Role: PLANNER

      You are participating as the planner in this collaborative workflow.

      **Responsibilities:**
      - Complete tasks assigned to your role
      - Communicate clearly with other participants
      - Hand off to the next appropriate role when done

      ## Getting Started

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id=test-squad-chatroom --role=planner --type=custom
      \`\`\`

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-squad-chatroom --role=planner
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-squad-chatroom --role=planner
      \`\`\`

      ## Team Roles

      planner, builder, reviewer

      ## Next Steps

      1. Run the **register-agent** command above to register your agent type
      2. Copy the **context read** command to review conversation history
      3. Run **wait-for-task** to receive your first task
      4. Follow the detailed instructions provided by the CLI
      "
    `);
  });
});
