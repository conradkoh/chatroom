import { describe, expect, it } from 'vitest';

import {
  favoritesKey,
  findFavoriteMismatches,
  type FindFavoriteMismatchesInput,
  type StartCheckLaunchRequest,
  type StartCheckWorkspace,
} from './favoriteStartMismatches';
import type { MachineConfigEntry } from '../types/machineConfig';

const ws1: StartCheckWorkspace = {
  id: 'ws-1',
  machineId: 'm1',
  workingDir: '/repo',
  label: 'repo',
};

const builderRequest: StartCheckLaunchRequest = {
  role: 'builder',
  agentHarness: 'claude',
  model: 'opus',
  workingDir: '/repo',
};

const opencodeGpt: MachineConfigEntry = { agentHarness: 'opencode', model: 'gpt' };
const claudeOpus: MachineConfigEntry = { agentHarness: 'claude', model: 'opus' };

/** Base input: the `builder` request mismatches its top favourite (`opencode/gpt`). */
function makeInput(
  overrides: Partial<FindFavoriteMismatchesInput> = {}
): FindFavoriteMismatchesInput {
  return {
    roles: ['builder'],
    workspaces: [ws1],
    requestsByWorkspace: new Map([['ws-1', [builderRequest]]]),
    favoritesByMachineRole: new Map([[favoritesKey('m1', 'builder'), [opencodeGpt]]]),
    availableHarnessesByMachine: new Map([['m1', ['claude', 'opencode']]]),
    runningRoles: new Set<string>(),
    ...overrides,
  };
}

describe('findFavoriteMismatches', () => {
  it('reports nothing when the machine-role key has no favourites', () => {
    expect(findFavoriteMismatches(makeInput({ favoritesByMachineRole: new Map() }))).toEqual([]);
  });

  it('reports nothing when the request equals the top favourite', () => {
    const result = findFavoriteMismatches(
      makeInput({
        favoritesByMachineRole: new Map([[favoritesKey('m1', 'builder'), [claudeOpus]]]),
      })
    );

    expect(result).toEqual([]);
  });

  it('reports a mismatch when the harness differs', () => {
    const result = findFavoriteMismatches(makeInput());

    expect(result).toEqual([
      {
        workspaceId: 'ws-1',
        workspaceLabel: 'repo',
        machineId: 'm1',
        workingDir: '/repo',
        role: 'builder',
        current: { agentHarness: 'claude', model: 'opus' },
        favorite: { agentHarness: 'opencode', model: 'gpt' },
      },
    ]);
  });

  it('reports a mismatch when only the model differs', () => {
    const result = findFavoriteMismatches(
      makeInput({
        favoritesByMachineRole: new Map([
          [favoritesKey('m1', 'builder'), [{ agentHarness: 'claude', model: 'sonnet' }]],
        ]),
        availableHarnessesByMachine: new Map([['m1', ['claude']]]),
      })
    );

    expect(result).toEqual([
      {
        workspaceId: 'ws-1',
        workspaceLabel: 'repo',
        machineId: 'm1',
        workingDir: '/repo',
        role: 'builder',
        current: { agentHarness: 'claude', model: 'opus' },
        favorite: { agentHarness: 'claude', model: 'sonnet' },
      },
    ]);
  });

  it('reports nothing for a role with no launch request', () => {
    expect(findFavoriteMismatches(makeInput({ requestsByWorkspace: new Map() }))).toEqual([]);
  });

  it('reports nothing for an incomplete saved request', () => {
    expect(
      findFavoriteMismatches(
        makeInput({
          requestsByWorkspace: new Map([['ws-1', [{ ...builderRequest, model: '' }]]]),
        })
      )
    ).toEqual([]);

    expect(
      findFavoriteMismatches(
        makeInput({
          requestsByWorkspace: new Map([['ws-1', [{ ...builderRequest, workingDir: '  ' }]]]),
        })
      )
    ).toEqual([]);
  });

  it('skips running roles, but keeps them when status is unknown', () => {
    expect(findFavoriteMismatches(makeInput({ runningRoles: new Set(['builder']) }))).toEqual([]);

    const unknownStatus = findFavoriteMismatches(makeInput({ runningRoles: undefined }));

    expect(unknownStatus.map((m) => `${m.workspaceId}/${m.role}`)).toEqual(['ws-1/builder']);
  });

  it('reports nothing when the top favourite harness is not installed', () => {
    const result = findFavoriteMismatches(
      makeInput({
        favoritesByMachineRole: new Map([
          [favoritesKey('m1', 'builder'), [{ agentHarness: 'cursor', model: 'x' }]],
        ]),
        availableHarnessesByMachine: new Map([['m1', ['claude']]]),
      })
    );

    expect(result).toEqual([]);
  });

  it('only considers favourites index 0', () => {
    const result = findFavoriteMismatches(
      makeInput({
        favoritesByMachineRole: new Map([
          [favoritesKey('m1', 'builder'), [claudeOpus, opencodeGpt]],
        ]),
      })
    );

    expect(result).toEqual([]);
  });

  it('checks each workspace against its own machine favourites', () => {
    const ws2: StartCheckWorkspace = {
      id: 'ws-2',
      machineId: 'm2',
      workingDir: '/repo2',
      label: 'repo2',
    };

    const result = findFavoriteMismatches(
      makeInput({
        workspaces: [ws1, ws2],
        requestsByWorkspace: new Map([
          ['ws-1', [builderRequest]],
          ['ws-2', [builderRequest]],
        ]),
        favoritesByMachineRole: new Map([
          [favoritesKey('m1', 'builder'), [claudeOpus]],
          [favoritesKey('m2', 'builder'), [opencodeGpt]],
        ]),
        availableHarnessesByMachine: new Map([
          ['m1', ['claude', 'opencode']],
          ['m2', ['claude', 'opencode']],
        ]),
      })
    );

    expect(result).toEqual([
      {
        workspaceId: 'ws-2',
        workspaceLabel: 'repo2',
        machineId: 'm2',
        workingDir: '/repo2',
        role: 'builder',
        current: { agentHarness: 'claude', model: 'opus' },
        favorite: { agentHarness: 'opencode', model: 'gpt' },
      },
    ]);
  });

  it('orders mismatches by workspace, then role', () => {
    const wsA: StartCheckWorkspace = {
      id: 'ws-a',
      machineId: 'm1',
      workingDir: '/a',
      label: 'a',
    };
    const wsB: StartCheckWorkspace = {
      id: 'ws-b',
      machineId: 'm1',
      workingDir: '/b',
      label: 'b',
    };
    const plannerRequest: StartCheckLaunchRequest = {
      role: 'planner',
      agentHarness: 'claude',
      model: 'opus',
      workingDir: '/x',
    };
    const builderRequestB: StartCheckLaunchRequest = {
      role: 'builder',
      agentHarness: 'opencode',
      model: 'gpt',
      workingDir: '/x',
    };

    const result = findFavoriteMismatches(
      makeInput({
        roles: ['planner', 'builder'],
        workspaces: [wsA, wsB],
        requestsByWorkspace: new Map([
          ['ws-a', [plannerRequest, builderRequestB]],
          ['ws-b', [plannerRequest, builderRequestB]],
        ]),
        favoritesByMachineRole: new Map([
          [favoritesKey('m1', 'planner'), [opencodeGpt]],
          [favoritesKey('m1', 'builder'), [claudeOpus]],
        ]),
      })
    );

    expect(result.map((m) => `${m.workspaceId}/${m.role}`)).toEqual([
      'ws-a/planner',
      'ws-a/builder',
      'ws-b/planner',
      'ws-b/builder',
    ]);
  });

  it('matches favourites case-insensitively but reports the requested role casing', () => {
    const upperRoleRequest: StartCheckLaunchRequest = { ...builderRequest, role: 'Builder' };

    const result = findFavoriteMismatches(
      makeInput({
        roles: ['Builder'],
        requestsByWorkspace: new Map([['ws-1', [upperRoleRequest]]]),
        favoritesByMachineRole: new Map([[favoritesKey('m1', 'Builder'), [opencodeGpt]]]),
      })
    );

    expect(result.map((m) => m.role)).toEqual(['Builder']);

    expect(
      findFavoriteMismatches(
        makeInput({
          roles: ['Builder'],
          requestsByWorkspace: new Map([['ws-1', [upperRoleRequest]]]),
          favoritesByMachineRole: new Map([[favoritesKey('m1', 'Builder'), [opencodeGpt]]]),
          runningRoles: new Set(['builder']),
        })
      )
    ).toEqual([]);
  });
});
