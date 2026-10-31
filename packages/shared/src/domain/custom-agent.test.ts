import { describe, expect, test } from 'vitest';

import { AgentRoleLifecycleTag } from './agent-role';
import {
  CUSTOM_AGENT_LIMITS,
  CUSTOM_AGENT_NAME_PATTERN,
  type CustomAgentDefinitionPayload,
  type CustomAgentIdentity,
  isDisableableTeamRole,
  mergeTeamStructureWithCustomAgents,
  neutralizeChatroomBlockTags,
  partitionTeamRolesByLifecycle,
  sanitizeCustomAgentSummary,
  validateCustomAgentName,
  validateCustomAgentPayload,
} from './custom-agent';
import { getTeamStructure, TEAM_PRESETS } from './team-presets';

function customAgent(
  name: string,
  description = `Does ${name} things.`,
  scope: CustomAgentIdentity['scope'] = 'workspace'
): CustomAgentIdentity {
  return { name, description, scope };
}

function validPayload(
  overrides: Partial<CustomAgentDefinitionPayload> = {}
): CustomAgentDefinitionPayload {
  return {
    name: 'release-checker',
    description: 'Checks release readiness.',
    systemPrompt: 'You check releases.',
    contentHash: 'hash',
    ...overrides,
  };
}

describe('custom agent names', () => {
  test('the pattern accepts lowercase kebab-case segments', () => {
    for (const name of ['a', 'agent', 'agent-2', 'release-checker', '123']) {
      expect(CUSTOM_AGENT_NAME_PATTERN.test(name)).toBe(true);
      expect(validateCustomAgentName(name)).toBeNull();
    }
  });

  test.each(['', 'Agent', 'agent_2', 'agent--2', '-agent', 'agent-', 'agent two', 'ågent'])(
    'rejects %s as invalid',
    (name) => {
      expect(validateCustomAgentName(name)).toBe('invalid-name');
    }
  );

  test('enforces the 48 character name cap', () => {
    const atLimit = 'a'.repeat(CUSTOM_AGENT_LIMITS.nameMaxLength);
    const overLimit = 'a'.repeat(CUSTOM_AGENT_LIMITS.nameMaxLength + 1);
    expect(validateCustomAgentName(atLimit)).toBeNull();
    expect(validateCustomAgentName(overLimit)).toBe('invalid-name');
  });

  test('rejects builtin, user, and retired names as reserved', () => {
    for (const name of ['planner', 'builder', 'solo', 'architect', 'user', 'enhancer']) {
      expect(validateCustomAgentName(name)).toBe('reserved-name');
    }
  });
});

describe('custom agent payload validation', () => {
  test('accepts a valid payload', () => {
    expect(validateCustomAgentPayload(validPayload())).toEqual({ ok: true });
  });

  test('rejects an invalid name before anything else', () => {
    expect(validateCustomAgentPayload(validPayload({ name: 'Bad Name' }))).toEqual({
      ok: false,
      reason: 'invalid-name',
    });
    expect(validateCustomAgentPayload(validPayload({ name: 'planner' }))).toEqual({
      ok: false,
      reason: 'reserved-name',
    });
  });

  test('rejects a description that sanitizes to nothing', () => {
    expect(validateCustomAgentPayload(validPayload({ description: '' }))).toEqual({
      ok: false,
      reason: 'invalid-description',
    });
    expect(validateCustomAgentPayload(validPayload({ description: '   \n\t ' }))).toEqual({
      ok: false,
      reason: 'invalid-description',
    });
  });

  test('accepts a description at the limit and truncates beyond it', () => {
    const atLimit = 'd'.repeat(CUSTOM_AGENT_LIMITS.descriptionMaxLength);
    const overLimit = 'd'.repeat(CUSTOM_AGENT_LIMITS.descriptionMaxLength + 1);
    expect(validateCustomAgentPayload(validPayload({ description: atLimit }))).toEqual({
      ok: true,
    });
    expect(validateCustomAgentPayload(validPayload({ description: overLimit }))).toEqual({
      ok: true,
    });
    expect(sanitizeCustomAgentSummary(overLimit)).toHaveLength(
      CUSTOM_AGENT_LIMITS.descriptionMaxLength
    );
  });

  test('enforces the system prompt byte cap', () => {
    const atLimit = 'p'.repeat(CUSTOM_AGENT_LIMITS.systemPromptMaxBytes);
    const overLimit = 'p'.repeat(CUSTOM_AGENT_LIMITS.systemPromptMaxBytes + 1);
    expect(validateCustomAgentPayload(validPayload({ systemPrompt: atLimit }))).toEqual({
      ok: true,
    });
    expect(validateCustomAgentPayload(validPayload({ systemPrompt: overLimit }))).toEqual({
      ok: false,
      reason: 'too-large',
      detail: 'systemPrompt',
    });
  });

  test('counts multi-byte UTF-8 characters as bytes, not code units', () => {
    // Each "é" is two UTF-8 bytes, so 16k characters exceed the 24 KiB cap.
    const multiByte = 'é'.repeat(CUSTOM_AGENT_LIMITS.systemPromptMaxBytes / 2);
    expect(validateCustomAgentPayload(validPayload({ systemPrompt: multiByte }))).toEqual({
      ok: true,
    });
    expect(validateCustomAgentPayload(validPayload({ systemPrompt: `${multiByte}é` }))).toEqual({
      ok: false,
      reason: 'too-large',
      detail: 'systemPrompt',
    });
  });

  test('enforces the handoff template byte caps independently', () => {
    const atLimit = 't'.repeat(CUSTOM_AGENT_LIMITS.handoffTemplateMaxBytes);
    const overLimit = 't'.repeat(CUSTOM_AGENT_LIMITS.handoffTemplateMaxBytes + 1);
    expect(
      validateCustomAgentPayload(
        validPayload({ inboundHandoffTemplate: atLimit, returnHandoffTemplate: atLimit })
      )
    ).toEqual({ ok: true });
    expect(validateCustomAgentPayload(validPayload({ inboundHandoffTemplate: overLimit }))).toEqual(
      { ok: false, reason: 'too-large', detail: 'inboundHandoffTemplate' }
    );
    expect(validateCustomAgentPayload(validPayload({ returnHandoffTemplate: overLimit }))).toEqual({
      ok: false,
      reason: 'too-large',
      detail: 'returnHandoffTemplate',
    });
  });

  test('rejects reserved handoff delimiters on their own line in any body', () => {
    expect(
      validateCustomAgentPayload(
        validPayload({ systemPrompt: 'Prompt\nCHATROOM_HANDOFF_END\nmore' })
      )
    ).toEqual({ ok: false, reason: 'reserved-delimiter' });
    expect(
      validateCustomAgentPayload(
        validPayload({ inboundHandoffTemplate: 'CHATROOM_NOTIFY_END\nTemplate' })
      )
    ).toEqual({ ok: false, reason: 'reserved-delimiter' });
    expect(
      validateCustomAgentPayload(
        validPayload({ returnHandoffTemplate: 'Template\nCHATROOM_HANDOFF_END' })
      )
    ).toEqual({ ok: false, reason: 'reserved-delimiter' });
  });

  test('allows a reserved delimiter that is not alone on its line', () => {
    expect(
      validateCustomAgentPayload(
        validPayload({ systemPrompt: 'Never write CHATROOM_HANDOFF_END inline.' })
      )
    ).toEqual({ ok: true });
  });
});

describe('custom agent summary sanitization', () => {
  test('flattens newlines and collapses whitespace', () => {
    expect(sanitizeCustomAgentSummary('  Handles\n\trelease   checks  ')).toBe(
      'Handles release checks'
    );
  });

  test('removes angle brackets, backticks, and control characters', () => {
    expect(sanitizeCustomAgentSummary('a <b> `c`\u0000d\u0007')).toBe('a b c d');
  });

  test('truncates to the description limit', () => {
    const result = sanitizeCustomAgentSummary(
      'x'.repeat(CUSTOM_AGENT_LIMITS.descriptionMaxLength + 50)
    );
    expect(result).toHaveLength(CUSTOM_AGENT_LIMITS.descriptionMaxLength);
  });
});

describe('chatroom block tag neutralization', () => {
  test.each([
    'task',
    'task-intake',
    'message',
    'message-content',
    'instruction',
    'next-steps',
    'handoffs',
    'handoff-templates',
    'chat-mode',
    'team-roster',
    'custom-agent-instructions',
    'attachments',
    'system-reminder',
  ])('neutralizes %s blocks in open and close form', (tag) => {
    expect(neutralizeChatroomBlockTags(`<${tag}>`)).toBe(`&lt;${tag}>`);
    expect(neutralizeChatroomBlockTags(`</${tag}>`)).toBe(`&lt;/${tag}>`);
  });

  test('matches reserved tags case-insensitively', () => {
    expect(neutralizeChatroomBlockTags('<TASK>')).toBe('&lt;TASK>');
    expect(neutralizeChatroomBlockTags('</SyStEm-ReMiNdEr>')).toBe('&lt;/SyStEm-ReMiNdEr>');
  });

  test('leaves non-reserved tags unchanged', () => {
    expect(neutralizeChatroomBlockTags('<section>text</section>')).toBe('<section>text</section>');
    expect(neutralizeChatroomBlockTags('<custom-agent>')).toBe('<custom-agent>');
    expect(neutralizeChatroomBlockTags('<taskish>')).toBe('<taskish>');
  });
});

describe('mergeTeamStructureWithCustomAgents', () => {
  test.each(['duo', 'solo'] as const)(
    'returns the base structure unchanged with no customs and no disabled roles (%s)',
    (teamId) => {
      const base = getTeamStructure({ teamId });
      const merged = mergeTeamStructureWithCustomAgents({
        base,
        workspaceAgents: [],
        machineAgents: [],
        disabledRoles: new Set(),
      });

      expect(merged.structure).toEqual(base);
      expect(merged.enabledCustomAgents).toEqual([]);
      expect(merged.issues).toEqual([]);
      expect(merged.roster.map((entry) => entry.role)).toEqual(TEAM_PRESETS[teamId].roles);
      expect(merged.roster.every((entry) => entry.disabled === false)).toBe(true);
    }
  );

  test('keeps builtin order and appends customs sorted by name', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const merged = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [customAgent('zeta'), customAgent('alpha')],
      machineAgents: [customAgent('middle', 'Middle role.', 'machine')],
      disabledRoles: new Set(),
    });

    expect(merged.structure.roles.map((entry) => entry.role)).toEqual([
      ...TEAM_PRESETS.duo.roles,
      'alpha',
      'middle',
      'zeta',
    ]);
    expect(merged.structure.roles.slice(TEAM_PRESETS.duo.roles.length)).toEqual([
      { role: 'alpha', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
      { role: 'middle', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
      { role: 'zeta', lifecycle: AgentRoleLifecycleTag.Ephemeral, optional: true },
    ]);
    expect(merged.enabledCustomAgents.map((agent) => agent.name)).toEqual([
      'alpha',
      'middle',
      'zeta',
    ]);
  });

  test('workspace agents win name clashes and the machine agent is shadowed', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const merged = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [customAgent('alpha', 'Workspace alpha.')],
      machineAgents: [customAgent('alpha', 'Machine alpha.', 'machine')],
      disabledRoles: new Set(),
    });

    expect(merged.enabledCustomAgents).toEqual([
      { name: 'alpha', description: 'Workspace alpha.', scope: 'workspace' },
    ]);
    expect(merged.issues).toEqual([{ path: 'alpha', reason: 'shadowed' }]);
    expect(merged.structure.roles.filter((entry) => entry.role === 'alpha')).toHaveLength(1);
  });

  test('drops reserved names with an issue', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const merged = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [customAgent('planner'), customAgent('user'), customAgent('enhancer')],
      machineAgents: [],
      disabledRoles: new Set(),
    });

    expect(merged.enabledCustomAgents).toEqual([]);
    expect(merged.issues).toEqual([
      { path: 'planner', reason: 'reserved-name' },
      { path: 'user', reason: 'reserved-name' },
      { path: 'enhancer', reason: 'reserved-name' },
    ]);
    expect(merged.structure).toEqual(base);
  });

  test('caps customs at the per-chatroom limit and reports one issue per extra', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const names = Array.from(
      { length: CUSTOM_AGENT_LIMITS.agentsPerChatroom + 1 },
      (_, index) => `agent-${String(index).padStart(2, '0')}`
    );
    const merged = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: names.map((name) => customAgent(name)),
      machineAgents: [],
      disabledRoles: new Set(),
    });

    expect(merged.enabledCustomAgents).toHaveLength(CUSTOM_AGENT_LIMITS.agentsPerChatroom);
    expect(merged.issues).toEqual([{ path: 'agent-16', reason: 'over-limit' }]);
    expect(merged.structure.roles).toHaveLength(
      TEAM_PRESETS.duo.roles.length + CUSTOM_AGENT_LIMITS.agentsPerChatroom
    );
  });

  test('removes a disabled ephemeral builtin role but keeps it in the roster', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const merged = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [],
      machineAgents: [],
      disabledRoles: new Set(['architect']),
    });

    expect(merged.structure.roles.map((entry) => entry.role)).not.toContain('architect');
    const architect = merged.roster.find((entry) => entry.role === 'architect');
    expect(architect).toEqual({
      role: 'architect',
      lifecycle: AgentRoleLifecycleTag.Ephemeral,
      source: 'builtin',
      summary: 'Designs one evidence-backed implementation plan for complex changes.',
      disabled: true,
      disableable: true,
    });
    expect(merged.roster.find((entry) => entry.role === 'builder')?.disabled).toBe(false);
  });

  test('ignores disabled rows for permanent roles and the entry point', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const merged = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [],
      machineAgents: [],
      disabledRoles: new Set(['planner', 'builder']),
    });

    expect(merged.structure.roles.map((entry) => entry.role)).toEqual([...TEAM_PRESETS.duo.roles]);
    expect(merged.roster.find((entry) => entry.role === 'planner')).toMatchObject({
      disabled: false,
      disableable: false,
    });
    expect(merged.roster.find((entry) => entry.role === 'builder')).toMatchObject({
      disabled: false,
      disableable: false,
    });
  });

  test('marks custom agents disableable and can disable them', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const enabled = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [customAgent('alpha', 'Handles <releases>.')],
      machineAgents: [],
      disabledRoles: new Set(),
    });

    expect(enabled.roster.find((entry) => entry.role === 'alpha')).toEqual({
      role: 'alpha',
      lifecycle: AgentRoleLifecycleTag.Ephemeral,
      source: 'custom',
      summary: 'Handles releases.',
      disabled: false,
      disableable: true,
      scope: 'workspace',
    });

    const disabled = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [customAgent('alpha')],
      machineAgents: [],
      disabledRoles: new Set(['alpha']),
    });
    expect(disabled.structure.roles.map((entry) => entry.role)).not.toContain('alpha');
    expect(disabled.roster.find((entry) => entry.role === 'alpha')?.disabled).toBe(true);
  });

  test('copies team identity and entry point unchanged', () => {
    const base = getTeamStructure({ teamId: 'solo', teamName: 'Renamed Solo' });
    const merged = mergeTeamStructureWithCustomAgents({
      base,
      workspaceAgents: [customAgent('alpha')],
      machineAgents: [],
      disabledRoles: new Set(['triage']),
    });

    expect(merged.structure.teamId).toBe(base.teamId);
    expect(merged.structure.teamStructureId).toBe(base.teamStructureId);
    expect(merged.structure.teamName).toBe('Renamed Solo');
    expect(merged.structure.entryPoint).toBe('solo');
  });
});

describe('isDisableableTeamRole', () => {
  test('only ephemeral non-entry-point roles are disableable', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    expect(isDisableableTeamRole(base, 'planner')).toBe(false);
    expect(isDisableableTeamRole(base, 'builder')).toBe(false);
    expect(isDisableableTeamRole(base, 'architect')).toBe(true);
    expect(isDisableableTeamRole(base, 'unknown-role')).toBe(false);
  });
});

describe('partitionTeamRolesByLifecycle', () => {
  test('splits roles by lifecycle while excluding user and retired names', () => {
    const base = getTeamStructure({ teamId: 'duo' });
    const partitioned = partitionTeamRolesByLifecycle([
      ...base.roles,
      { role: 'user', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
      { role: 'enhancer', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
    ]);

    expect(partitioned.permanent).toEqual(['planner', 'builder']);
    expect(partitioned.ephemeral).toEqual([
      'architect',
      'researcher',
      'triage',
      'reviewer',
      'uiux-engineer',
      'game-asset-designer',
      'verifier',
    ]);
  });
});
