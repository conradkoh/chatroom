/**
 * Squad Team Prompt Integration Tests
 *
 * Tests the prompt generation for the squad team (planner/builder/reviewer),
 * including init prompts, role-specific guidance, and dynamic workflow variants.
 *
 * Follows the same patterns as wait-for-task-prompt.spec.ts for the pair team.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { t } from '../../../test.setup';

/**
 * Helper to create a test session and authenticate
 */
async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

/**
 * Helper to create a Squad team chatroom
 */
async function createSquadTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'squad',
    teamName: 'Squad Team',
    teamRoles: ['planner', 'builder', 'reviewer'],
    teamEntryPoint: 'planner',
  });
  return chatroomId;
}

/**
 * Helper to join participants to the chatroom
 */
async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  const readyUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
      readyUntil,
    });
  }
}

// =============================================================================
// PLANNER ROLE PROMPTS
// =============================================================================

describe('Squad Team - Planner Init Prompt', () => {
  test('planner receives correct init prompt with full team', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-squad-planner-init');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // ===== GET INIT PROMPT =====
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    const prompt = initPrompt!.prompt;

    // ===== VERIFY STRUCTURE =====

    // Should have Squad Team header
    expect(prompt).toContain('# Squad Team');

    // Should identify as Planner
    expect(prompt).toContain('## Your Role: PLANNER');
    expect(prompt).toContain('team coordinator');

    // Should have Getting Started section with CHATROOM_CONVEX_URL commands
    expect(prompt).toContain('## Getting Started');
    expect(prompt).toContain('### Read Context');
    expect(prompt).toContain('### Wait for Tasks');
    expect(prompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Planner IS the entry point — should have Classify Task
    expect(prompt).toContain('### Classify Task');
    expect(prompt).toContain('--origin-message-classification');

    // Should have planner-specific workflow instructions
    expect(prompt).toContain('## Planner Workflow');
    expect(prompt).toContain('single point of contact');

    // Should mention team availability
    expect(prompt).toContain('Team Availability');

    // Should have commands section
    expect(prompt).toContain('### Commands');
    expect(prompt).toContain('chatroom handoff');

    // Planner CAN hand off to user
    expect(prompt).toContain('user');

    // Should have next steps
    expect(prompt).toContain('### Next');
    expect(prompt).toContain('chatroom wait-for-task');
  });

  test('planner rolePrompt contains full agent setup for remote agents', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-squad-planner-role-prompt');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // ===== GET INIT PROMPT =====
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    const rolePrompt = initPrompt!.rolePrompt;

    // Should have Squad Team header
    expect(rolePrompt).toContain('# Squad Team');

    // Should have Getting Started with CHATROOM_CONVEX_URL
    expect(rolePrompt).toContain('## Getting Started');
    expect(rolePrompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Planner is entry point — should have Classify Task
    expect(rolePrompt).toContain('### Classify Task');
    expect(rolePrompt).toContain('--origin-message-classification');

    // Should have planner workflow
    expect(rolePrompt).toContain('## Planner Workflow');

    // Should have commands
    expect(rolePrompt).toContain('### Commands');
    expect(rolePrompt).toContain('chatroom handoff');

    // Should have next steps
    expect(rolePrompt).toContain('### Next');
  });

  test('planner initialMessage is currently empty (reserved for future use)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-squad-planner-init-message');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    expect(initPrompt?.initialMessage).toBe('');
  });
});

// =============================================================================
// BUILDER ROLE PROMPTS (Squad context)
// =============================================================================

describe('Squad Team - Builder Init Prompt', () => {
  test('builder receives correct init prompt in squad context', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-squad-builder-init');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // ===== GET INIT PROMPT =====
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    const prompt = initPrompt!.prompt;

    // Should have Squad Team header
    expect(prompt).toContain('# Squad Team');

    // Should identify as Builder
    expect(prompt).toContain('## Your Role: BUILDER');

    // Should have Getting Started with CHATROOM_CONVEX_URL
    expect(prompt).toContain('## Getting Started');
    expect(prompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Builder is NOT entry point in squad — should have Start Working, not Classify Task
    expect(prompt).toContain('### Start Working');
    expect(prompt).toContain('--no-classify');
    expect(prompt).not.toContain('### Classify Task');

    // Should have squad-specific builder guidance
    expect(prompt).toContain('## Builder Workflow');
    expect(prompt).toContain('Squad Team Context');
    expect(prompt).toContain('do NOT communicate directly with the user');

    // Builder should NOT have 'user' in handoff targets
    // The restriction message should appear
    expect(prompt).toContain('only the planner can hand off to the user');

    // Should have commands section
    expect(prompt).toContain('### Commands');
    expect(prompt).toContain('chatroom handoff');
  });

  test('builder rolePrompt contains squad-specific restrictions', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-squad-builder-role-prompt');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    const rolePrompt = initPrompt!.rolePrompt;

    // Should have Squad Team header
    expect(rolePrompt).toContain('# Squad Team');

    // Should have squad-specific context
    expect(rolePrompt).toContain('Squad Team Context');
    expect(rolePrompt).toContain('planner who coordinates');

    // Should NOT be able to hand off to user
    expect(rolePrompt).toContain('NEVER hand off directly to');

    // Builder is NOT entry point — should have Start Working
    expect(rolePrompt).toContain('### Start Working');
    expect(rolePrompt).not.toContain('### Classify Task');
  });
});

// =============================================================================
// REVIEWER ROLE PROMPTS (Squad context)
// =============================================================================

describe('Squad Team - Reviewer Init Prompt', () => {
  test('reviewer receives correct init prompt in squad context', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-squad-reviewer-init');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // ===== GET INIT PROMPT =====
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'reviewer',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    const prompt = initPrompt!.prompt;

    // Should have Squad Team header
    expect(prompt).toContain('# Squad Team');

    // Should identify as Reviewer
    expect(prompt).toContain('## Your Role: REVIEWER');

    // Should have Getting Started with CHATROOM_CONVEX_URL
    expect(prompt).toContain('## Getting Started');
    expect(prompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Reviewer is NOT entry point — should have Start Working
    expect(prompt).toContain('### Start Working');
    expect(prompt).toContain('--no-classify');
    expect(prompt).not.toContain('### Classify Task');

    // Should have squad-specific reviewer guidance
    expect(prompt).toContain('## Reviewer Workflow');
    expect(prompt).toContain('Squad Team Context');
    expect(prompt).toContain('do NOT communicate directly with the user');

    // Reviewer should NOT have 'user' in handoff targets — restriction notice
    expect(prompt).toContain('Restriction');
    expect(prompt).toContain('only the planner can hand off to the user');

    // Should have review policies
    expect(prompt).toContain('Available Review Policies');

    // Should have commands section
    expect(prompt).toContain('### Commands');
    expect(prompt).toContain('chatroom handoff');
  });

  test('reviewer rolePrompt contains squad-specific restrictions', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-squad-reviewer-role-prompt');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'reviewer',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    const rolePrompt = initPrompt!.rolePrompt;

    // Should have Squad Team header
    expect(rolePrompt).toContain('# Squad Team');

    // Should have squad-specific context
    expect(rolePrompt).toContain('Squad Team Context');
    expect(rolePrompt).toContain('planner who coordinates');

    // Should NOT be able to hand off to user
    expect(rolePrompt).toContain('NEVER hand off directly to');

    // Reviewer is NOT entry point — should have Start Working
    expect(rolePrompt).toContain('### Start Working');
    expect(rolePrompt).not.toContain('### Classify Task');
  });
});

// =============================================================================
// PLANNER AS SINGLE POINT OF CONTACT
// =============================================================================

describe('Squad Team - Planner as Point of Contact', () => {
  test('only planner has user in handoff targets', async () => {
    const { sessionId } = await createTestSession('test-squad-handoff-targets');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // Get all three init prompts
    const [plannerPrompt, builderPrompt, reviewerPrompt] = await Promise.all([
      t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
        convexUrl: 'http://127.0.0.1:3210',
      }),
      t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
        convexUrl: 'http://127.0.0.1:3210',
      }),
      t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'reviewer',
        convexUrl: 'http://127.0.0.1:3210',
      }),
    ]);

    // Planner prompt should list 'user' as a handoff target (in Handoff Options section)
    expect(plannerPrompt!.prompt).toContain('### Handoff Options');
    expect(plannerPrompt!.prompt).toMatch(/Available targets:.*user/);

    // Builder and reviewer should have restriction notice about not handing off to user
    expect(builderPrompt!.prompt).toContain('only the planner can hand off to the user');
    expect(reviewerPrompt!.prompt).toContain('only the planner can hand off to the user');
  });

  test('planner is the entry point and classifies messages', async () => {
    const { sessionId } = await createTestSession('test-squad-entry-point');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    const [plannerPrompt, builderPrompt, reviewerPrompt] = await Promise.all([
      t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
        convexUrl: 'http://127.0.0.1:3210',
      }),
      t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
        convexUrl: 'http://127.0.0.1:3210',
      }),
      t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'reviewer',
        convexUrl: 'http://127.0.0.1:3210',
      }),
    ]);

    // Only planner should have Classify Task (as entry point)
    expect(plannerPrompt!.prompt).toContain('### Classify Task');

    // Builder and reviewer should have Start Working (non-entry point)
    expect(builderPrompt!.prompt).toContain('### Start Working');
    expect(reviewerPrompt!.prompt).toContain('### Start Working');
  });
});

// =============================================================================
// ROLEPROMT = PROMPT WHEN INITMESSAGE IS EMPTY
// =============================================================================

describe('Squad Team - rolePrompt equals combined prompt', () => {
  test('rolePrompt equals combined prompt for all squad roles when initMessage is empty', async () => {
    const { sessionId } = await createTestSession('test-squad-role-prompt-equals');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    for (const role of ['planner', 'builder', 'reviewer']) {
      const initPrompt = await t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role,
        convexUrl: 'http://127.0.0.1:3210',
      });

      expect(initPrompt).toBeDefined();

      // When initMessage is empty, rolePrompt should equal the combined prompt
      if (!initPrompt?.initialMessage || initPrompt.initialMessage.trim() === '') {
        expect(initPrompt?.rolePrompt).toBe(initPrompt?.prompt);
      }
    }
  });
});
