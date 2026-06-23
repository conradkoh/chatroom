import { describe, expect, test } from 'vitest';

import { getBuilderGuidance } from '../../../prompts/cli/roles/builder';
import { getPlannerGuidance } from '../../../prompts/cli/roles/planner';
import { composeSystemPrompt } from '../../../prompts/generator';
import {
  getHandoffContinuityRule,
  getSessionContinuityLine,
  getWorkflowLoopFooter,
} from '../../../prompts/native/session-continuity';

describe('native session continuity', () => {
  test('native mode omits CLI listen-loop language from continuity helpers', () => {
    expect(getSessionContinuityLine(true)).toBe('');
    expect(getHandoffContinuityRule(true)).toBe('');
    expect(getWorkflowLoopFooter(true)).toBe('Hand off when complete');
    expect(getWorkflowLoopFooter(true)).not.toContain('get-next-task');
  });

  test('CLI mode retains get-next-task language', () => {
    expect(getSessionContinuityLine(false)).toContain('get-next-task');
    expect(getHandoffContinuityRule(false)).toContain('get-next-task');
    expect(getWorkflowLoopFooter(false)).toContain('get-next-task');
  });

  test('planner guidance with nativeIntegration=true omits get-next-task', () => {
    const guidance = getPlannerGuidance({
      role: 'planner',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: true,
      convexUrl: 'http://127.0.0.1:3210',
      chatroomId: 'test-room',
      nativeIntegration: true,
    });

    expect(guidance).not.toMatch(/get-next-task/i);
    expect(guidance).not.toContain('task injection');
    expect(guidance).not.toMatch(/task read --chatroom-id/i);
  });

  test('builder guidance with nativeIntegration=true omits get-next-task and Level A/B', () => {
    const guidance = getBuilderGuidance({
      role: 'builder',
      teamRoles: ['planner', 'builder'],
      isEntryPoint: false,
      convexUrl: 'http://127.0.0.1:3210',
      codeChangesTarget: 'planner',
      questionTarget: 'planner',
      nativeIntegration: true,
    });

    expect(guidance).not.toMatch(/get-next-task/i);
    expect(guidance).not.toContain('Level A');
    expect(guidance).not.toContain('Level B');
  });

  test('composeSystemPrompt native duo planner has no CLI listen loop or session model', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'test-room',
      role: 'planner',
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
      agentHarness: 'cursor-sdk',
    });

    expect(prompt).not.toMatch(/get-next-task/i);
    expect(prompt).not.toContain('task injection');
    expect(prompt).not.toContain('Level A');
    expect(prompt).not.toContain('Level B');
    expect(prompt).not.toContain('Two-Level Model');
    expect(prompt).not.toContain('## Getting Started');
    expect(prompt).not.toContain('## Begin With the End in Mind');
    expect(prompt).toContain('## Builder delegation brief');
    expect(prompt).toMatch(/do not run `register-agent`/i);
  });

  test('composeSystemPrompt native duo builder has no CLI listen loop', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'test-room',
      role: 'builder',
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
      convexUrl: 'http://127.0.0.1:3210',
      agentHarness: 'opencode-sdk',
    });

    expect(prompt).not.toMatch(/get-next-task/i);
    expect(prompt).not.toContain('task injection');
  });
});
