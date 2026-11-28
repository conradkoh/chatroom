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

/**
 * Length budget for native duo/planner init with shared inter-role guidance.
 * Raised from 12900 to admit the bug-report-to-triage nudge bullet (~270 characters),
 * then from 13200 to admit the verify-before-delivering nudge bullet (~180 characters),
 * then from 13400 to admit the notify-user command block and single-handoff bullet
 * in the shared commands reference (~760 characters), then from 14200 to admit the
 * visibility-consistency rewording of the user-communication and handoff-completeness
 * bullets (~32 characters), then from 14300 to admit the notify-user vs. handoff
 * conditional rewording in the inter-role handoff rule and commands reference (~370 characters),
 * then from 14700 to admit the review-on-demand delegation rule (~250 characters),
 * then from 15000 to admit the game-assets-via-designer delegation rule (~270 characters),
 * then from 15500 to admit the expanded game-assets-via-designer boundary, routing,
 * and evidence-acceptance rule (~700 characters),
 * then from 16000 to admit the asset-generation and asset-integration routing rule
 * that replaces it (~300 characters),
 * then from 16500 to admit the architect-gate delegation rule that routes backend
 * contract, API, and schema/persistence changes through the architect first (~275 characters),
 * then from 16800 to admit the 3D-model generation routing and model-id requirement
 * in the game-assets-via-designer delegation rule (~200 characters),
 * then from 17000 to admit the generate-3d output-path rule (`--out` sets the
 * package base, `--package-dir` moves the zip and preview; ~160 characters; the
 * package layout lives in the designer prompt and handoff template, not here),
 * then from 17200 to admit the generate-3d default model and rig rule
 * (references and bundle contents stay in the designer prompt and guide;
 * ~200 characters), then from 17500 to admit the lighting-contract field and
 * lighting gate in the game-assets-via-designer delegation rule (~400 characters),
 * then from 18000 to admit the asset-in-rig render and verification-only lighting
 * brief in the same rule (~560 characters),
 * then from 18700 to admit the shared test-seam glossary term (~240 characters),
 * then from 19000 to admit the show-an-existing-file delegation bullet
 * (~410 characters),
 * then from 19500 to admit the product-manager activation gate (~980 characters;
 * the specification sections live in the product-manager handoff template, not here),
 * then from 22500 to admit the shared decision-routing rule and the reworded
 * product-manager clause (~1230 characters),
 * then from 23500 to admit the conversation carve-out in the routing rules,
 * the softened decision-routing opening, and the request-to-build framing of
 * the product-manager gate (~440 characters),
 * then from 24000 to admit the grounding publish guidance paragraph and its
 * heredoc command block (~1000 characters).
 * then from 25000 to admit the prompt-engineer routing rule, its per-team
 * delegation wording, and the product-manager gate addition (~510 characters).
 *
 * Measured on 2026-11-28: this prompt renders at 25,529 characters through the
 * same `composeNativeSystemPrompt` call the length test below uses
 * (duo/planner, `cursor-sdk`, `TEAM_CONFIGS.duo`). The budget is the measured
 * length plus a 200-character margin, so the later rule-number prose package
 * (item 6, ~55 characters) fits with ~145 characters still spare.
 */
const NATIVE_DUO_PLANNER_INIT_MEASURED_LENGTH = 25529;
const NATIVE_DUO_PLANNER_INIT_MARGIN = 200;
const NATIVE_DUO_PLANNER_INIT_MAX_LENGTH =
  NATIVE_DUO_PLANNER_INIT_MEASURED_LENGTH + NATIVE_DUO_PLANNER_INIT_MARGIN;

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
    // `undefined` is not a native harness, so composeSystemPrompt takes the
    // still-live CLI branch without relying on a retired CLI harness literal.
    agentHarness: undefined,
  });
}

describe('Native init — slim session model (no CLI listen loop)', () => {
  for (const scenario of NATIVE_INIT_SCENARIOS) {
    test(`${scenario.team}/${scenario.role} omits get-next-task and Level A/B`, () => {
      const prompt = nativeInitPrompt(scenario.team, scenario.role);
      assertNativeInitContract(prompt, {
        soloTeam: scenario.soloTeam,
        noTaskRead: scenario.noTaskRead,
        operatingModelHeading: scenario.operatingModelHeading,
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
    const prompt = cliInitPrompt('duo', 'planner');
    expect(prompt).not.toContain('Begin With the End in Mind');
    expect(prompt).not.toContain('Planner → User report');
    // CLI discovery intentionally advertises the pair-keyed view-template command.
    expect(prompt).toContain('chatroom handoff view-template');
  });

  test('architect and UI/UX init preserve their disclosure contract', () => {
    for (const role of ['architect', 'uiux-engineer']) {
      const prompt = nativeInitPrompt('duo', role);
      expect(prompt).toContain(
        role === 'architect' ? '## Architect Operating Model' : '## UI/UX Engineer Operating Model'
      );
      expect(prompt).not.toContain('CHATROOM_ENHANCER_END');
    }
  });
});

describe('Native init — commands reference', () => {
  test('includes handoff and notify-user (no view-template or get-next-task)', () => {
    const prompt = nativeInitPrompt('duo', 'builder');
    expect(prompt).toContain('### Commands');
    expect(prompt).toContain('chatroom handoff');
    expect(prompt).toContain('chatroom notify-user');
    expect(prompt).toContain('CHATROOM_NOTIFY_END');
    expect(prompt).not.toContain('report-progress');
    expect(prompt).not.toContain('handoff view-template');
    expect(prompt).not.toContain('chatroom get-next-task');
  });

  test('CLI init advertises notify-user with its heredoc delimiter', () => {
    const prompt = cliInitPrompt('duo', 'builder');
    expect(prompt).toContain('chatroom notify-user');
    expect(prompt).toContain('CHATROOM_NOTIFY_END');
    expect(prompt).toContain('chatroom get-next-task');
  });

  test('init prompts no longer claim progress reports are invisible to the user', () => {
    const prompts = [
      nativeInitPrompt('duo', 'builder'),
      nativeInitPrompt('duo', 'planner'),
      cliInitPrompt('duo', 'planner'),
      cliInitPrompt('solo', 'solo'),
    ];
    for (const prompt of prompts) {
      expect(prompt).not.toContain('progress reports');
      expect(prompt).not.toContain('all other messages are invisible');
      expect(prompt).not.toContain('can ONLY see');
      expect(prompt).not.toContain('ONLY role that communicates');
    }
  });

  test('includes role title, compact glossary, role guidance, and recovery commands', () => {
    const prompt = nativeInitPrompt('duo', 'planner');
    expect(prompt).toMatch(/# (Planner|Your Role)/i);
    expect(prompt).toContain('# Glossary');
    expect(prompt).toContain('## Planner Operating Model');
    expect(prompt).toContain('get-system-prompt');
    expect(prompt).toContain('get-role-guidance');
    expect(prompt).not.toContain('context read');
  });
});

describe('Native init — Phase 1 guardrails', () => {
  test('custom agent (agentType custom, no harness) takes the CLI prompt path', () => {
    const config = TEAM_CONFIGS.duo;
    const prompt = composeSystemPrompt({
      chatroomId: 'test-chatroom-id',
      role: 'builder',
      teamId: config.teamId,
      teamName: config.teamName,
      teamRoles: config.teamRoles,
      teamEntryPoint: config.teamEntryPoint,
      convexUrl: CONVEX_URL,
      agentType: 'custom',
    });
    expect(prompt).toContain('chatroom get-next-task');
  });

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
