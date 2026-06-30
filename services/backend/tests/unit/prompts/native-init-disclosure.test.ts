/**
 * Native init vs CLI init — template and command disclosure.
 *
 * Init teaches commands and workflow; eager templates are inlined on each
 * native task delivery (see native-workflow-disclosure.test.ts).
 */

import { describe, expect, test } from 'vitest';

import { composeSystemPrompt } from '../../../prompts/generator';
import { composeNativeSystemPrompt } from '../../../prompts/native/system-prompt';
import { assertNativeInitContract } from '../../helpers/native-init-contract';
import { assertNativeInitTemplateDisclosure } from '../../helpers/native-workflow-assertions';
import { NATIVE_INIT_SCENARIOS, TEAM_CONFIGS } from '../../helpers/native-workflow-fixtures';

const CONVEX_URL = 'http://127.0.0.1:3210';

/** Length budget for native duo/planner init — below pre-slim size, above new slim prompt. */
const NATIVE_DUO_PLANNER_INIT_MAX_LENGTH = 6000;

function nativeInitPrompt(team: keyof typeof TEAM_CONFIGS, role: string): string {
  const config = TEAM_CONFIGS[team];
  return composeSystemPrompt({
    chatroomId: 'test-chatroom-id',
    role,
    teamId: config.teamId,
    teamName: config.teamName,
    teamRoles: config.teamRoles,
    teamEntryPoint: config.teamEntryPoint,
    convexUrl: CONVEX_URL,
    agentHarness: 'cursor-sdk',
  });
}

function cliInitPrompt(team: keyof typeof TEAM_CONFIGS, role: string): string {
  const config = TEAM_CONFIGS[team];
  return composeSystemPrompt({
    chatroomId: 'test-chatroom-id',
    role,
    teamId: config.teamId,
    teamName: config.teamName,
    teamRoles: config.teamRoles,
    teamEntryPoint: config.teamEntryPoint,
    convexUrl: CONVEX_URL,
    agentHarness: 'opencode',
  });
}

describe('Native init — slim session model (no CLI listen loop)', () => {
  for (const scenario of NATIVE_INIT_SCENARIOS) {
    test(`${scenario.team}/${scenario.role} omits get-next-task and Level A/B`, () => {
      const prompt = nativeInitPrompt(scenario.team, scenario.role);
      assertNativeInitContract(prompt, {
        soloTeam: scenario.soloTeam,
        noTaskRead: scenario.noTaskRead,
        maxLength:
          scenario.team === 'duo' && scenario.role === 'planner'
            ? NATIVE_DUO_PLANNER_INIT_MAX_LENGTH
            : undefined,
      });
    });
  }
});

describe('Init — templates deferred to task delivery', () => {
  test('native init does not include Begin With the End in Mind preview', () => {
    assertNativeInitTemplateDisclosure(nativeInitPrompt('duo', 'builder'));
  });

  test('native planner init does not reference task delivery templates', () => {
    assertNativeInitTemplateDisclosure(nativeInitPrompt('duo', 'planner'));
  });

  test('CLI init also defers templates to task delivery (no init preview)', () => {
    assertNativeInitTemplateDisclosure(cliInitPrompt('duo', 'planner'));
  });
});

describe('Native init — commands reference', () => {
  test('includes handoff only (no view-template or get-next-task)', () => {
    const prompt = nativeInitPrompt('duo', 'builder');
    expect(prompt).toContain('### Commands');
    expect(prompt).toContain('chatroom handoff');
    expect(prompt).not.toContain('report-progress');
    expect(prompt).not.toContain('handoff view-template');
    expect(prompt).not.toContain('chatroom get-next-task');
  });

  test('includes role title, compact glossary, and recovery commands', () => {
    const prompt = nativeInitPrompt('duo', 'planner');
    expect(prompt).toMatch(/# (Planner|Your Role)/i);
    expect(prompt).toContain('# Glossary');
    expect(prompt).toContain('get-system-prompt');
    expect(prompt).toContain('context read');
  });
});

describe('Native init — Phase 1 guardrails', () => {
  test('does not contain mandatory pnpm typecheck language', () => {
    const prompt = nativeInitPrompt('duo', 'builder');
    expect(prompt).not.toContain('pnpm typecheck');
  });

  test('duo planner init length is below budget', () => {
    const config = TEAM_CONFIGS.duo;
    const prompt = composeNativeSystemPrompt({
      chatroomId: 'test-chatroom-id',
      role: 'planner',
      teamId: config.teamId,
      teamName: config.teamName,
      teamRoles: config.teamRoles,
      teamEntryPoint: config.teamEntryPoint,
      convexUrl: CONVEX_URL,
      agentHarness: 'cursor-sdk',
    });
    expect(prompt.length).toBeLessThan(NATIVE_DUO_PLANNER_INIT_MAX_LENGTH);
  });
});
