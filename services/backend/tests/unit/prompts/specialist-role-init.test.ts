import { describe, expect, test } from 'vitest';

import { composeSystemPrompt } from '../../../prompts/generator';

describe('specialist role init prompts', () => {
  for (const role of ['architect', 'uiux-engineer']) {
    for (const [harness, agentHarness] of [
      ['CLI', undefined],
      ['native', 'cursor-sdk'],
    ] as const) {
      test(`${role} includes specialist guidance in ${harness} composition`, () => {
        const prompt = composeSystemPrompt({
          chatroomId: 'specialist-room',
          role,
          teamId: 'configured-specialists',
          teamName: 'Configured Specialists',
          teamRoles: ['planner', role],
          teamEntryPoint: role,
          convexUrl: 'http://127.0.0.1:3210',
          agentType: 'custom',
          agentHarness,
        });

        expect(prompt).toContain(
          role === 'architect' ? '## Your Role: ARCHITECT' : '## Your Role: UI/UX ENGINEER'
        );
        expect(prompt).toContain(
          role === 'architect'
            ? '## Architect Operating Model'
            : '## UI/UX Engineer Operating Model'
        );
        expect(prompt).not.toContain('CHATROOM_ENHANCER_END');
      });
    }
  }
});
