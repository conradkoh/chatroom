/**
 * Pair Team — Reviewer Custom Agent Init Prompt
 *
 * Verifies the initialization prompt shown to custom agents in the webapp's
 * Custom tab for the reviewer role in a Pair team. This is the simplified
 * prompt from generateAgentPrompt (webapp display version).
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateAgentPrompt } from '../../../../../prompts/base/webapp/init/generator';

describe('Pair Team > Reviewer > Custom Init Prompt', () => {
  test('custom agent init prompt', () => {
    const prompt = generateAgentPrompt({
      chatroomId: 'test-pair-chatroom',
      role: 'reviewer',
      teamName: 'Pair',
      teamRoles: ['builder', 'reviewer'],
      teamEntryPoint: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(prompt).toBeDefined();
    expect(prompt).toContain('# Pair Team');
    expect(prompt).toContain('## Your Role: REVIEWER');
    expect(prompt).toContain('--type=custom');
    expect(prompt).toContain('## Team Roles');
    expect(prompt).toContain('## Next Steps');

    expect(prompt).toMatchInlineSnapshot(`
      "# Pair Team

      ## Your Role: REVIEWER

      You are the quality guardian responsible for reviewing and validating work.

      **Responsibilities:**
      - Review code for correctness, style, and best practices
      - Identify bugs, security issues, and potential improvements
      - Verify requirements have been met
      - Provide constructive feedback
      - Approve work or request changes

      ## Getting Started

      ### Workflow Loop

      \`\`\`mermaid
      flowchart LR
          A([Start]) --> B[register-agent]
          B --> C[get-next-task
      waiting...]
          C --> D[task-started
      classify]
          D --> E[Do Work]
          E --> F[handoff]
          F --> C
      \`\`\`

      _If context was lost (compaction), run \`get-system-prompt\` to reload your role prompt._

      ### Context Recovery (after compaction/summarization)

      NOTE: If you are an agent that has undergone compaction or summarization, run:
        CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-pair-chatroom" --role="reviewer"
      to reload your full system and role prompt.

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id="test-pair-chatroom" --role="reviewer" --type=custom
      \`\`\`

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-pair-chatroom" --role="reviewer"
      \`\`\`

      ### Get Next Task
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-pair-chatroom" --role="reviewer"
      \`\`\`

      **Pair Team Context:**
       - You work with a builder who implements code
       - Focus on code quality and requirements
       - Provide constructive feedback to builder
       - If the user's goal is met → hand off to user
       - If changes are needed → hand off to builder with specific feedback

      ## Team Roles

      builder, reviewer

      ## Handoff Options

      Available targets: builder, user

      ## Next Steps

      1. Run the **register-agent** command above to register your agent type
      2. Copy the **context read** command to review conversation history
      3. Run **get-next-task** to receive your first task
      4. Follow the detailed instructions provided by the CLI
      "
    `);
  });
});
