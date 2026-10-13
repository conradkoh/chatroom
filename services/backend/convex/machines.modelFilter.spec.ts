/**
 * machines.upsertMachineModelFilters — saving a filter removes hidden models from the
 * current user's favourites for that machine and harness.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';

const PLANNER_SCOPE = 'team_duo#role_planner';
const BUILDER_SCOPE = 'team_duo#role_builder';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return id as SessionId;
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: `${machineId}-host`,
    os: 'linux',
    availableHarnesses: ['opencode', 'cursor-sdk'],
  });
}

async function readFavorites(sessionId: SessionId, machineId: string, teamRoleKey: string) {
  const result = await t.query(api.machineConfigFavorites.getMachineConfigFavorites, {
    sessionId,
    machineId,
    teamRoleKey,
  });
  return result.favorites;
}

test('hiding a model removes it from favourites for that harness across every team+role scope', async () => {
  const sessionId = await createTestSession('model-filter-prune-scopes');
  const machineId = 'model-filter-prune-scopes-machine';
  await registerMachine(sessionId, machineId);

  await t.mutation(api.machineConfigFavorites.setMachineConfigFavorites, {
    sessionId,
    machineId,
    teamRoleKey: PLANNER_SCOPE,
    favorites: [
      { agentHarness: 'opencode', model: 'openai/gpt-4' },
      { agentHarness: 'opencode', model: 'openai/gpt-3.5' },
      { agentHarness: 'cursor-sdk', model: 'openai/gpt-4' },
    ],
  });
  await t.mutation(api.machineConfigFavorites.setMachineConfigFavorites, {
    sessionId,
    machineId,
    teamRoleKey: BUILDER_SCOPE,
    favorites: [
      { agentHarness: 'opencode', model: 'openai/gpt-4' },
      { agentHarness: 'opencode', model: 'anthropic/claude' },
    ],
  });

  await t.mutation(api.machines.upsertMachineModelFilters, {
    sessionId,
    machineId,
    agentHarness: 'opencode',
    hiddenModels: ['openai/gpt-4'],
    hiddenProviders: [],
  });

  expect(await readFavorites(sessionId, machineId, PLANNER_SCOPE)).toEqual([
    { agentHarness: 'opencode', model: 'openai/gpt-3.5' },
    { agentHarness: 'cursor-sdk', model: 'openai/gpt-4' },
  ]);
  expect(await readFavorites(sessionId, machineId, BUILDER_SCOPE)).toEqual([
    { agentHarness: 'opencode', model: 'anthropic/claude' },
  ]);
});

test('hiding a provider removes its favourites for that harness and keeps the row when it empties', async () => {
  const sessionId = await createTestSession('model-filter-prune-provider');
  const machineId = 'model-filter-prune-provider-machine';
  await registerMachine(sessionId, machineId);

  await t.mutation(api.machineConfigFavorites.setMachineConfigFavorites, {
    sessionId,
    machineId,
    teamRoleKey: PLANNER_SCOPE,
    favorites: [{ agentHarness: 'opencode', model: 'openai/gpt-4' }],
  });

  await t.mutation(api.machines.upsertMachineModelFilters, {
    sessionId,
    machineId,
    agentHarness: 'opencode',
    hiddenModels: [],
    hiddenProviders: ['openai'],
  });

  expect(await readFavorites(sessionId, machineId, PLANNER_SCOPE)).toEqual([]);
});

test('favourites on another machine of the same user are unchanged', async () => {
  const sessionId = await createTestSession('model-filter-prune-other-machine');
  const machineId = 'model-filter-prune-target-machine';
  const otherMachineId = 'model-filter-prune-other-machine';
  await registerMachine(sessionId, machineId);
  await registerMachine(sessionId, otherMachineId);

  await t.mutation(api.machineConfigFavorites.setMachineConfigFavorites, {
    sessionId,
    machineId: otherMachineId,
    teamRoleKey: PLANNER_SCOPE,
    favorites: [{ agentHarness: 'opencode', model: 'openai/gpt-4' }],
  });

  await t.mutation(api.machines.upsertMachineModelFilters, {
    sessionId,
    machineId,
    agentHarness: 'opencode',
    hiddenModels: ['openai/gpt-4'],
    hiddenProviders: [],
  });

  expect(await readFavorites(sessionId, otherMachineId, PLANNER_SCOPE)).toEqual([
    { agentHarness: 'opencode', model: 'openai/gpt-4' },
  ]);
});

test('a save that hides nothing leaves favourites unchanged', async () => {
  const sessionId = await createTestSession('model-filter-prune-noop');
  const machineId = 'model-filter-prune-noop-machine';
  await registerMachine(sessionId, machineId);

  const favorites = [
    { agentHarness: 'opencode' as const, model: 'anthropic/claude' },
    { agentHarness: 'opencode' as const, model: 'openai/gpt-4' },
  ];
  await t.mutation(api.machineConfigFavorites.setMachineConfigFavorites, {
    sessionId,
    machineId,
    teamRoleKey: PLANNER_SCOPE,
    favorites,
  });

  await t.mutation(api.machines.upsertMachineModelFilters, {
    sessionId,
    machineId,
    agentHarness: 'opencode',
    hiddenModels: [],
    hiddenProviders: [],
  });

  expect(await readFavorites(sessionId, machineId, PLANNER_SCOPE)).toEqual(favorites);
});
