/**
 * Solo Team — Solo Agent System Prompt
 *
 * Verifies the system prompt delivered to custom agents acting as solo
 * in a Solo team. This is the `prompt` field from getInitPrompt (the combined
 * init prompt printed to CLI for agents without system prompt control).
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { t } from '../../../../../test.setup';

async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

async function createSoloTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'solo',
    teamName: 'Solo Team',
    teamRoles: ['solo'],
    teamEntryPoint: 'solo',
  });
}

async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
    });
  }
}

describe('Solo Team > Solo > System Prompt', () => {
  test('system prompt for custom agent', async () => {
    const { sessionId } = await createTestSession('test-solo-system-prompt');
    const chatroomId = await createSoloTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['solo']);

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'solo',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    expect(initPrompt?.hasSystemPromptControl).toBe(false);

    const prompt = initPrompt?.prompt;
    expect(prompt).toBeDefined();

    // Team header
    expect(prompt).toContain('# Solo Team');

    // Role identity
    expect(prompt).toContain('## Your Role: SOLO');
    expect(prompt).toContain('autonomous agent');

    // Getting Started section
    expect(prompt).toContain('## Getting Started');

    // Solo is entry point — should have classification section
    expect(prompt).toContain('### Classify Task');

    // Solo workflow guidance
    expect(prompt).toContain('Solo Workflow');
    expect(prompt).toContain('Solo Team Context');

    // Solo can hand off to user
    expect(prompt).toContain('### Handoff Options');
    expect(prompt).toContain('Available targets: user');

    // Commands reference
    expect(prompt).toContain('### Commands');

    // Solo role identity — no handoff to other team members
    // (Note: 'builder'/'planner'/'reviewer' may appear in global
    // glossary/skill descriptions — those are not team-specific)
    expect(prompt).not.toContain('hand off to builder');
    expect(prompt).not.toContain('delegate to planner');

    // Implementation keywords
    expect(prompt).toContain('implement');
    expect(prompt).toContain('plan');
    expect(prompt).toContain('workflow');
  });
});
