/**
 * Native init vs CLI init — template and command disclosure.
 *
 * Init teaches commands and workflow; eager templates are inlined on each
 * native task delivery (see native-workflow-disclosure.test.ts).
 */

import { describe, expect, test } from 'vitest';

import { composeSystemPrompt } from '../../../prompts/generator';
import { assertNativeInitContract } from '../../helpers/native-init-contract';
import {
  assertCliInitTemplateDisclosure,
  assertNativeInitTemplateDisclosure,
} from '../../helpers/native-workflow-assertions';
import { NATIVE_INIT_SCENARIOS, TEAM_CONFIGS } from '../../helpers/native-workflow-fixtures';

const CONVEX_URL = 'http://127.0.0.1:3210';

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
        entryPoint: scenario.entryPoint,
        soloTeam: scenario.soloTeam,
        noTaskRead: scenario.noTaskRead,
      });
    });
  }
});

describe('Native init — templates deferred to task delivery', () => {
  test('native init does not include Begin With the End in Mind preview', () => {
    assertNativeInitTemplateDisclosure(nativeInitPrompt('duo', 'builder'));
  });

  test('planner init points delegation guidance at delivery handoff-templates', () => {
    assertNativeInitTemplateDisclosure(nativeInitPrompt('duo', 'planner'), {
      referencesDeliveryTemplates: true,
    });
  });

  test('CLI init still includes Begin With the End in Mind at startup', () => {
    assertCliInitTemplateDisclosure(cliInitPrompt('duo', 'planner'));
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
});
