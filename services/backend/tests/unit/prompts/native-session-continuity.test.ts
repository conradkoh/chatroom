import { describe, expect, test } from 'vitest';

import { getBuilderGuidance } from '../../../prompts/cli/roles/builder';
import { getPlannerGuidance } from '../../../prompts/cli/roles/planner';
import { getReviewerGuidance } from '../../../prompts/cli/roles/reviewer';
import { composeSystemPrompt } from '../../../prompts/generator';
import {
  getHandoffContinuityRule,
  getSessionContinuityLine,
  getWorkflowLoopFooter,
} from '../../../prompts/native/session-continuity';
import { getSoloGuidance } from '../../../prompts/teams/solo/prompts/solo';
import { NATIVE_AGENT_HARNESSES } from '../../helpers/native-harnesses';
import { assertNativeInitContract } from '../../helpers/native-init-contract';

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
    expect(guidance).not.toMatch(/task read/i);
  });

  test('reviewer guidance with nativeIntegration=true omits get-next-task', () => {
    const guidance = getReviewerGuidance({
      role: 'reviewer',
      teamRoles: ['planner', 'builder', 'reviewer'],
      isEntryPoint: false,
      convexUrl: 'http://127.0.0.1:3210',
      approvalTarget: 'planner',
      nativeIntegration: true,
    });

    expect(guidance).not.toMatch(/get-next-task/i);
    expect(guidance).not.toContain('Level A');
    expect(guidance).not.toContain('Level B');
    expect(guidance).not.toMatch(/task read/i);
  });

  test('solo guidance with nativeIntegration=true omits get-next-task and task read', () => {
    const guidance = getSoloGuidance({
      role: 'solo',
      teamRoles: ['solo'],
      isEntryPoint: true,
      convexUrl: 'http://127.0.0.1:3210',
      chatroomId: 'test-room',
      nativeIntegration: true,
    });

    expect(guidance).not.toMatch(/get-next-task/i);
    expect(guidance).not.toMatch(/task read/i);
    expect(guidance).not.toContain('Classification (Entry Point Role)');
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

  for (const agentHarness of NATIVE_AGENT_HARNESSES) {
    test(`composeSystemPrompt native solo (${agentHarness}) matches init contract`, () => {
      const prompt = composeSystemPrompt({
        chatroomId: 'test-room',
        role: 'solo',
        teamId: 'solo',
        teamName: 'Solo Team',
        teamRoles: ['solo'],
        teamEntryPoint: 'solo',
        convexUrl: 'http://127.0.0.1:3210',
        agentHarness,
      });

      assertNativeInitContract(prompt, {
        entryPoint: true,
        soloTeam: true,
        noTaskRead: true,
      });
    });
  }
});
