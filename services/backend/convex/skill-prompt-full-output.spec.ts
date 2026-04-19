/**
 * Tests for skill prompt full output verification.
 * 
 * These tests verify what the agent sees EXACTLY when a skill is activated.
 * The key is that the skill.activated event contains a 'prompt' field
 * that is what gets used as the system prompt for the agent.
 */

import { describe, expect, test } from 'vitest';

import { t } from './test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { SessionId } from 'convex-helpers/server/sessions';
import { DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE } from '../src/domain/types/skills';

const DEVELOPMENT_WORKFLOW_TYPE = DEVELOPMENT_WORKFLOW_CUSTOMIZATION_TYPE;

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

describe('skill activation: what the agent sees', () => {
  test('development-workflow: agent sees custom prompt when customization exists', async () => {
    const { sessionId } = await createTestSession('agent-sees-custom-1');
    const chatroomId = await createChatroom(sessionId);

    // Create custom prompt - this is what user configured in webapp
    const customContent = '## Development & Release Flow\n\nCommit the changes directly in master';
    await t.mutation(api.chatroomSkillCustomizations.create, {
      sessionId,
      chatroomId,
      type: DEVELOPMENT_WORKFLOW_TYPE,
      name: 'Custom Workflow',
      content: customContent,
    });

    // Activate the skill
    const result = await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'development-workflow',
      role: 'builder',
    });

    expect(result.success).toBe(true);

    // Get the skill.activated event to see what was stored
    const event = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'skill.activated'))
        .first();
    });

    expect(event).toBeDefined();
    
    // THIS IS THE KEY: The prompt field is what the agent sees
    // When agent asks "what do I see", this is the prompt content
    expect(event?.prompt).toBe(customContent);
    
    // Also verify other fields are correctly set
    expect(event?.skillId).toBe('development-workflow');
    expect(event?.skillName).toBe('Development & Release Workflow');
    expect(event?.role).toBe('builder');
  });

  test('development-workflow: agent sees full default prompt when no customization', async () => {
    const { sessionId } = await createTestSession('agent-sees-default-1');
    const chatroomId = await createChatroom(sessionId);

    // Activate WITHOUT creating any customization
    const result = await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'development-workflow',
      role: 'builder',
    });

    expect(result.success).toBe(true);

    // Get the skill.activated event
    const event = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'skill.activated'))
        .first();
    });

    expect(event).toBeDefined();
    
    // The FULL prompt the agent sees - comprehensive release workflow
    const fullPrompt = event?.prompt;
    expect(fullPrompt).toContain('You have been activated with the "development-workflow" skill');
    expect(fullPrompt).toContain('## Release Workflow');
    expect(fullPrompt).toContain('Create a Release Branch and PR');
    expect(fullPrompt).toContain('release/v<X.Y.Z>');
    expect(fullPrompt).toContain('Squash-Merge Changes Into the Release Branch');
    expect(fullPrompt).toContain('Merge the Release Branch to Master');
  });
});
