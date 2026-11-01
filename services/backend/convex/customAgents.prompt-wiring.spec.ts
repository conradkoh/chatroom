/**
 * End-to-end prompt wiring: definitions synced into Convex must reach the role
 * prompt and the init prompt for the roles that use them, while builtin roles in
 * a chatroom that carries custom agents stay byte-identical.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { readCustomAgentPromptContext } from '../src/domain/usecase/custom-agents/read-custom-agent-prompt-context';
import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { withActiveTeamStructure } from './lib/chatroomTeam';
import { defaultInboundHandoffTemplate } from '../prompts/custom-agents/default-handoff-templates';

type TestAgent = {
  name: string;
  description: string;
  systemPrompt: string;
  inboundHandoffTemplate?: string;
  returnHandoffTemplate?: string;
  contentHash: string;
  disabled: boolean;
};

function makeAgent(
  name: string,
  overrides: Partial<Omit<TestAgent, 'name' | 'contentHash'>> = {}
): TestAgent {
  return {
    name,
    description: overrides.description ?? `${name} role.`,
    systemPrompt: overrides.systemPrompt ?? `You are ${name}.`,
    contentHash: `${name}-hash`,
    disabled: overrides.disabled ?? false,
    ...(overrides.inboundHandoffTemplate !== undefined
      ? { inboundHandoffTemplate: overrides.inboundHandoffTemplate }
      : {}),
    ...(overrides.returnHandoffTemplate !== undefined
      ? { returnHandoffTemplate: overrides.returnHandoffTemplate }
      : {}),
  };
}

interface Fixture {
  sessionId: SessionId;
  machineId: string;
  workingDir: string;
  chatroomId: Id<'chatroom_rooms'>;
}

async function setupChatroom(suffix: string, workingDir = '/test/workspace'): Promise<Fixture> {
  const sessionId = `custom-agent-wiring-${suffix}` as SessionId;
  const machineId = `custom-agent-wiring-machine-${suffix}`;

  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
  });
  const { chatroomId } = await t.mutation(api.chatrooms.createWithWorkspace, {
    sessionId,
    teamStructureId: 'duo',
    machineId,
    workingDir,
  });
  return { sessionId, machineId, workingDir, chatroomId };
}

async function syncWorkspaceAgents(
  fixture: Fixture,
  agents: TestAgent[],
  contentHash = 'workspace-hash'
): Promise<void> {
  await t.mutation(api.customAgents.syncDefinitions, {
    sessionId: fixture.sessionId,
    machineId: fixture.machineId,
    scope: 'workspace',
    workingDir: fixture.workingDir,
    contentHash,
    agents,
    issues: [],
  });
}

async function rolePrompt(fixture: Fixture, role: string): Promise<string> {
  const result = await t.query(api.messages.getRolePrompt, {
    sessionId: fixture.sessionId,
    chatroomId: fixture.chatroomId,
    role,
  });
  return result.prompt;
}

async function initPrompt(fixture: Fixture, role: string): Promise<string> {
  const result = await t.query(api.messages.getInitPrompt, {
    sessionId: fixture.sessionId,
    chatroomId: fixture.chatroomId,
    role,
  });
  return result.prompt;
}

/** The chatroom id is embedded in CLI commands; normalise it so two rooms compare. */
function normalizeChatroomIds(prompt: string, chatroomId: string): string {
  return prompt.split(chatroomId).join('<chatroom-id>');
}

/** Normalise any id that legitimately differs between two equivalent fixtures. */
function normalizeIds(prompt: string, ids: readonly string[]): string {
  return ids.reduce((text, id) => text.split(id).join('<id>'), prompt);
}

async function seedTask(fixture: Fixture, role: string): Promise<Id<'chatroom_tasks'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('chatroom_tasks', {
      chatroomId: fixture.chatroomId,
      createdBy: 'user',
      content: 'Do the work.',
      status: 'in_progress',
      assignedTo: role,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      queuePosition: 0,
    })
  );
}

async function deliveryPrompt(
  fixture: Fixture,
  role: string,
  taskId: Id<'chatroom_tasks'>
): Promise<string> {
  const result = await t.query(api.messages.getTaskDeliveryPrompt, {
    sessionId: fixture.sessionId,
    chatroomId: fixture.chatroomId,
    role,
    taskId,
  });
  return result.fullCliOutput;
}

describe('custom agent prompt wiring', () => {
  test('a custom role prompt carries its instructions and return handoff template', async () => {
    const fixture = await setupChatroom('self');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', {
        systemPrompt: 'You are alpha.',
        returnHandoffTemplate: '## Summary\n\nAlpha returns.',
      }),
    ]);

    const prompt = await rolePrompt(fixture, 'alpha');

    expect(prompt).toContain('<custom-agent-instructions>');
    expect(prompt).toContain('You are alpha.');
    expect(prompt).toContain('</custom-agent-instructions>');
    expect(prompt).toContain('### Handoff template `alpha` → `planner`');
    expect(prompt).toContain('Alpha returns.');
    expect(prompt).not.toContain('<team-roster>');
  });

  test('the entry point prompt carries the roster and one inbound template per enabled agent', async () => {
    const fixture = await setupChatroom('entry');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { inboundHandoffTemplate: '## Task\n\nAlpha inbound.' }),
      makeAgent('beta'),
    ]);

    const prompt = await rolePrompt(fixture, 'planner');

    expect(prompt).toContain('<team-roster>');
    expect(prompt).toContain('- alpha — alpha role.');
    expect(prompt).toContain('- beta — beta role.');
    expect(prompt).toContain('### Handoff template `planner` → `alpha`');
    expect(prompt).toContain('Alpha inbound.');
    expect(prompt).toContain('### Handoff template `planner` → `beta`');
    expect(prompt).toContain(defaultInboundHandoffTemplate('beta'));
    expect(prompt).not.toContain('<custom-agent-instructions>');
  });

  test('the init prompt carries the same custom sections', async () => {
    const fixture = await setupChatroom('init');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { returnHandoffTemplate: '## Summary\n\nAlpha returns.' }),
    ]);

    const selfPrompt = await initPrompt(fixture, 'alpha');
    expect(selfPrompt).toContain('<custom-agent-instructions>');
    expect(selfPrompt).toContain('### Handoff template `alpha` → `planner`');
    expect(selfPrompt).toContain('Alpha returns.');

    const entryPrompt = await initPrompt(fixture, 'planner');
    expect(entryPrompt).toContain('<team-roster>');
    expect(entryPrompt).toContain('### Handoff template `planner` → `alpha`');
  });

  test('a disabled agent leaves the roster but keeps its own instructions', async () => {
    const fixture = await setupChatroom('disabled');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { disabled: true, systemPrompt: 'Disabled alpha still runs.' }),
      makeAgent('beta'),
    ]);

    const entryPrompt = await rolePrompt(fixture, 'planner');
    expect(entryPrompt).toContain('### Handoff template `planner` → `beta`');
    expect(entryPrompt).not.toContain('### Handoff template `planner` → `alpha`');
    expect(entryPrompt).not.toContain('Disabled alpha still runs.');

    const ownPrompt = await rolePrompt(fixture, 'alpha');
    expect(ownPrompt).toContain('Disabled alpha still runs.');
  });

  test('enabled custom agents add no custom sections to a builtin role prompt', async () => {
    const fixture = await setupChatroom('builtin-with', '/test/with-customs');
    await syncWorkspaceAgents(fixture, [makeAgent('alpha')]);

    const prompt = await rolePrompt(fixture, 'builder');

    expect(prompt).not.toContain('<custom-agent-instructions>');
    expect(prompt).not.toContain('<team-roster>');
    expect(prompt).not.toContain('### Handoff template `alpha` →');
  });

  test('a disabled custom agent leaves a builtin role prompt byte-identical', async () => {
    // A disabled agent is excluded from the merged team, so `teamRoles` (and the
    // handoff-target list built from it) matches the chatroom that has none.
    const withCustoms = await setupChatroom('builtin-disabled-with', '/test/disabled-with');
    const withoutCustoms = await setupChatroom(
      'builtin-disabled-without',
      '/test/disabled-without'
    );
    await syncWorkspaceAgents(withCustoms, [makeAgent('alpha', { disabled: true })]);

    const withPrompt = await rolePrompt(withCustoms, 'builder');
    const withoutPrompt = await rolePrompt(withoutCustoms, 'builder');

    expect(normalizeChatroomIds(withPrompt, withCustoms.chatroomId)).toBe(
      normalizeChatroomIds(withoutPrompt, withoutCustoms.chatroomId)
    );
  });

  test('a disabled custom agent leaves a builtin init prompt byte-identical', async () => {
    const withCustoms = await setupChatroom('builtin-init-with', '/test/init-with');
    const withoutCustoms = await setupChatroom('builtin-init-without', '/test/init-without');
    await syncWorkspaceAgents(withCustoms, [makeAgent('alpha', { disabled: true })]);

    const withPrompt = await initPrompt(withCustoms, 'builder');
    const withoutPrompt = await initPrompt(withoutCustoms, 'builder');

    expect(normalizeChatroomIds(withPrompt, withCustoms.chatroomId)).toBe(
      normalizeChatroomIds(withoutPrompt, withoutCustoms.chatroomId)
    );
    expect(withPrompt).not.toContain('<custom-agent-instructions>');
    expect(withPrompt).not.toContain('<team-roster>');
  });

  test('a duo chatroom with a workspace and no custom agents adds no custom context', async () => {
    // The zero-agent case is the one that must stay byte-identical to a team
    // with no custom-agent feature at all: a primary workspace exists, but no
    // source was ever pushed.
    const fixture = await setupChatroom('zero-agents');

    const context = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', fixture.chatroomId);
      if (chatroom === null) throw new Error('chatroom fixture is missing');
      const resolved = await withActiveTeamStructure(ctx, chatroom);
      expect(resolved.primaryWorkspace).not.toBeNull();
      const custom = await readCustomAgentPromptContext(ctx, {
        chatroom: resolved,
        role: 'planner',
      });
      // `t.run` serialises `undefined` to `null`, so report the boolean instead.
      return custom !== undefined;
    });

    expect(context).toBe(false);

    const prompt = await rolePrompt(fixture, 'planner');
    expect(prompt).not.toContain('<team-roster>');
    expect(prompt).not.toContain('<custom-agent-instructions>');
  });
});

describe('custom agent task delivery', () => {
  test('a task delivered to a custom role carries its return handoff template', async () => {
    const fixture = await setupChatroom('delivery-self');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { returnHandoffTemplate: '## Summary\n\nAlpha delivers.' }),
    ]);
    const taskId = await seedTask(fixture, 'alpha');

    const output = await deliveryPrompt(fixture, 'alpha', taskId);

    expect(output).toContain('### Handoff template `alpha` → `planner`');
    expect(output).toContain('Alpha delivers.');
    expect(output).toContain('Fill in the message using the `alpha` → `planner` template');
  });

  test('a task delivered to the entry point carries the roster and each inbound template', async () => {
    const fixture = await setupChatroom('delivery-entry');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { inboundHandoffTemplate: '## Task\n\nAlpha inbound.' }),
      makeAgent('beta'),
    ]);
    const taskId = await seedTask(fixture, 'planner');

    const output = await deliveryPrompt(fixture, 'planner', taskId);

    expect(output).toContain('<team-roster>');
    expect(output).toContain('- alpha — alpha role.');
    expect(output).toContain('### Handoff template `planner` → `alpha`');
    expect(output).toContain('Alpha inbound.');
    expect(output).toContain('### Handoff template `planner` → `beta`');
    expect(output).toContain(defaultInboundHandoffTemplate('beta'));
  });

  test('a disabled agent leaves the delivery roster but keeps its own template', async () => {
    const fixture = await setupChatroom('delivery-disabled');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', {
        disabled: true,
        returnHandoffTemplate: '## Summary\n\nDisabled alpha still delivers.',
      }),
      makeAgent('beta'),
    ]);

    const entryTask = await seedTask(fixture, 'planner');
    const entryOutput = await deliveryPrompt(fixture, 'planner', entryTask);
    expect(entryOutput).toContain('### Handoff template `planner` → `beta`');
    expect(entryOutput).not.toContain('### Handoff template `planner` → `alpha`');

    const ownTask = await seedTask(fixture, 'alpha');
    const ownOutput = await deliveryPrompt(fixture, 'alpha', ownTask);
    expect(ownOutput).toContain('### Handoff template `alpha` → `planner`');
    expect(ownOutput).toContain('Disabled alpha still delivers.');
  });

  test('a disabled custom agent leaves a builtin delivery byte-identical', async () => {
    const withCustoms = await setupChatroom('delivery-builtin-with', '/test/delivery-with');
    const withoutCustoms = await setupChatroom(
      'delivery-builtin-without',
      '/test/delivery-without'
    );
    await syncWorkspaceAgents(withCustoms, [makeAgent('alpha', { disabled: true })]);

    const withTask = await seedTask(withCustoms, 'builder');
    const withoutTask = await seedTask(withoutCustoms, 'builder');
    const withOutput = await deliveryPrompt(withCustoms, 'builder', withTask);
    const withoutOutput = await deliveryPrompt(withoutCustoms, 'builder', withoutTask);

    expect(normalizeIds(withOutput, [withCustoms.chatroomId, withTask])).toBe(
      normalizeIds(withoutOutput, [withoutCustoms.chatroomId, withoutTask])
    );
    expect(withOutput).not.toContain('<team-roster>');
    expect(withOutput).not.toContain('<custom-agent-instructions>');
  });
});
