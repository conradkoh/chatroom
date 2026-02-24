/**
 * Duo Team — Planner Custom Agent Init Prompt
 *
 * Verifies the initialization prompt shown to custom agents in the webapp's
 * Custom tab for the planner role in a Duo team. This is the simplified
 * prompt from generateAgentPrompt (webapp display version).
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateAgentPrompt } from '../../../../../prompts/base/webapp/init/generator';

describe('Duo Team > Planner > Custom Init Prompt', () => {
  test('custom agent init prompt', () => {
    const prompt = generateAgentPrompt({
      chatroomId: 'test-duo-chatroom',
      role: 'planner',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(prompt).toBeDefined();
    expect(prompt).toContain('# Duo Team');
    expect(prompt).toContain('## Your Role: PLANNER');
    expect(prompt).toContain('--type=custom');
    expect(prompt).toContain('## Team Roles');
    expect(prompt).toContain('planner, builder');
    expect(prompt).toContain('## Next Steps');
    // Planner is the entry point and communicates with user
    expect(prompt).toContain('Only you can hand off to');
  });
});
