/**
 * Solo team — Solo Guidance Unit Tests
 *
 * Verifies that the solo guidance prompt contains appropriate content
 * and avoids references to other team members.
 */

import { describe, expect, test } from 'vitest';

import { getSoloGuidance } from '../../../prompts/teams/solo/prompts/solo';

/** Minimal params for testing getSoloGuidance */
const baseParams = {
  role: 'solo',
  teamRoles: ['solo'],
  isEntryPoint: true,
  convexUrl: 'http://127.0.0.1:3210',
  chatroomId: 'test-chatroom',
};

describe('solo > getSoloGuidance', () => {
  test('returns non-empty guidance string', () => {
    const guidance = getSoloGuidance(baseParams);
    expect(guidance).toBeTruthy();
    expect(guidance.length).toBeGreaterThan(100);
  });

  test('contains solo operating model and team context', () => {
    const guidance = getSoloGuidance(baseParams);
    expect(guidance).toContain('Solo Operating Model');
    expect(guidance).toContain('Solo Team Context');
    expect(guidance).toContain('autonomous agent');
  });

  test('contains classification section when entry point', () => {
    const guidance = getSoloGuidance({ ...baseParams, isEntryPoint: true });
    expect(guidance).toContain('Classification');
    expect(guidance).toContain('task read');
  });

  test('native integration omits CLI classification note and get-next-task', () => {
    const guidance = getSoloGuidance({
      ...baseParams,
      isEntryPoint: true,
      nativeIntegration: true,
    });
    expect(guidance).not.toContain('Classification (Entry Point Role)');
    expect(guidance).not.toMatch(/task read/i);
    expect(guidance).not.toMatch(/get-next-task/i);
    expect(guidance).toContain('Receive user message');
    expect(guidance).toContain('Hand off when complete');
    expect(guidance).not.toContain('After ANY handoff');
  });

  test('CLI mode still includes get-next-task in operating model and handoff rules', () => {
    const guidance = getSoloGuidance({ ...baseParams, nativeIntegration: false });
    expect(guidance).toContain('get-next-task');
    expect(guidance).toContain('After ANY handoff');
  });

  test('does not contain classification when not entry point', () => {
    const guidance = getSoloGuidance({ ...baseParams, isEntryPoint: false });
    expect(guidance).not.toContain('Classification (Entry Point Role)');
  });

  test('contains key solo behaviors', () => {
    const guidance = getSoloGuidance(baseParams);
    // Must mention key solo responsibilities
    expect(guidance).toContain('plan');
    expect(guidance).toContain('implement');
    expect(guidance).toContain('Operating model');
    expect(guidance).toContain('user');
  });

  test('does not delegate to other team members', () => {
    const guidance = getSoloGuidance(baseParams);
    // No delegation to other roles — solo handles everything
    expect(guidance).not.toContain('hand off to builder');
    expect(guidance).not.toContain('delegate to planner');
    expect(guidance).not.toContain('hand off to reviewer');
  });

  test('contains handoff rules section', () => {
    const guidance = getSoloGuidance(baseParams);
    expect(guidance).toContain('Handoff Rules');
    // Solo can handoff directly to user
    expect(guidance).toContain('user');
  });

  test('contains implementation guidelines', () => {
    const guidance = getSoloGuidance(baseParams);
    expect(guidance).toContain('Implementation Guidelines');
    expect(guidance).toContain('typecheck');
    expect(guidance).toContain('atomic');
  });
});
