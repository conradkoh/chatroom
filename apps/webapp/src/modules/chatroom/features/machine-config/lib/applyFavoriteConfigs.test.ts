import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it, vi } from 'vitest';

import {
  applyFavoriteConfigs,
  applyFavoriteConfigsAndRestart,
  type ApplyConfigArgs,
  type ApplyFavoriteConfigItem,
  type SaveConfigArgs,
} from './applyFavoriteConfigs';

function item(role: string, entry: ApplyFavoriteConfigItem['entry']): ApplyFavoriteConfigItem {
  return {
    chatroomId: 'room-1' as Id<'chatroom_rooms'>,
    workspaceId: 'ws-1' as Id<'chatroom_workspaces'>,
    machineId: 'm1',
    workingDir: '/repo',
    role,
    entry,
  };
}

const plannerItem = item('planner', { agentHarness: 'claude-sdk', model: 'opus' });
const builderItem = item('builder', { agentHarness: 'opencode-sdk', model: 'gpt' });

describe('applyFavoriteConfigs', () => {
  it('applies every item in input order when all saves resolve', async () => {
    const saveConfig = vi.fn<(args: SaveConfigArgs) => Promise<unknown>>().mockResolvedValue(null);

    const result = await applyFavoriteConfigs(saveConfig, [plannerItem, builderItem]);

    expect(result).toEqual({
      applied: [
        { role: 'planner', entry: { agentHarness: 'claude-sdk', model: 'opus' } },
        { role: 'builder', entry: { agentHarness: 'opencode-sdk', model: 'gpt' } },
      ],
      failed: [],
    });
  });

  it('reports a rejected save and still applies the other roles', async () => {
    const saveConfig = vi
      .fn<(args: SaveConfigArgs) => Promise<unknown>>()
      .mockImplementation((args) =>
        args.role === 'planner' ? Promise.reject(new Error('harness missing')) : Promise.resolve()
      );

    const result = await applyFavoriteConfigs(saveConfig, [plannerItem, builderItem]);

    expect(result).toEqual({
      applied: [{ role: 'builder', entry: { agentHarness: 'opencode-sdk', model: 'gpt' } }],
      failed: [{ role: 'planner', message: 'harness missing' }],
    });
  });

  it('uses the fallback message when a save rejects with a non-Error', async () => {
    const saveConfig = vi
      .fn<(args: SaveConfigArgs) => Promise<unknown>>()
      .mockImplementation((args) =>
        args.role === 'planner' ? Promise.reject('boom') : Promise.resolve()
      );

    const result = await applyFavoriteConfigs(saveConfig, [plannerItem, builderItem]);

    expect(result.failed).toEqual([{ role: 'planner', message: 'Failed to save configuration' }]);
    expect(result.applied).toEqual([
      { role: 'builder', entry: { agentHarness: 'opencode-sdk', model: 'gpt' } },
    ]);
  });

  it('turns a synchronous throw into a failure for that item only', async () => {
    const saveConfig = vi
      .fn<(args: SaveConfigArgs) => Promise<unknown>>()
      .mockImplementation((args) => {
        if (args.role === 'planner') throw new Error('sync boom');
        return Promise.resolve();
      });

    const result = await applyFavoriteConfigs(saveConfig, [plannerItem, builderItem]);

    expect(result).toEqual({
      applied: [{ role: 'builder', entry: { agentHarness: 'opencode-sdk', model: 'gpt' } }],
      failed: [{ role: 'planner', message: 'sync boom' }],
    });
  });

  it('maps each item to the saveConfig arguments', async () => {
    const saveConfig = vi.fn<(args: SaveConfigArgs) => Promise<unknown>>().mockResolvedValue(null);

    await applyFavoriteConfigs(saveConfig, [plannerItem, builderItem]);

    expect(saveConfig).toHaveBeenNthCalledWith(1, {
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'planner',
      machineId: 'm1',
      agentHarness: 'claude-sdk',
      model: 'opus',
      workingDir: '/repo',
    });
    expect(saveConfig).toHaveBeenNthCalledWith(2, {
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'builder',
      machineId: 'm1',
      agentHarness: 'opencode-sdk',
      model: 'gpt',
      workingDir: '/repo',
    });
  });

  it('reports applied entries without the extra item fields', async () => {
    const saveConfig = vi.fn<(args: SaveConfigArgs) => Promise<unknown>>().mockResolvedValue(null);

    const result = await applyFavoriteConfigs(saveConfig, [plannerItem]);

    expect(result.applied).toEqual([
      { role: 'planner', entry: { agentHarness: 'claude-sdk', model: 'opus' } },
    ]);
  });
});

describe('applyFavoriteConfigsAndRestart', () => {
  it('calls applyConfig once per item with the server-derived arguments only', async () => {
    const applyConfig = vi
      .fn<(args: ApplyConfigArgs) => Promise<{ outcome: 'restarted' }>>()
      .mockResolvedValue({ outcome: 'restarted' });

    await applyFavoriteConfigsAndRestart(applyConfig, [plannerItem, builderItem]);

    expect(applyConfig).toHaveBeenCalledTimes(2);
    expect(applyConfig).toHaveBeenNthCalledWith(1, {
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'planner',
      agentHarness: 'claude-sdk',
      model: 'opus',
    });
    expect(applyConfig).toHaveBeenNthCalledWith(2, {
      chatroomId: 'room-1',
      workspaceId: 'ws-1',
      role: 'builder',
      agentHarness: 'opencode-sdk',
      model: 'gpt',
    });
    const firstArgs = applyConfig.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(firstArgs).not.toHaveProperty('machineId');
    expect(firstArgs).not.toHaveProperty('workingDir');
  });

  it('maps each outcome into the applied entries', async () => {
    const applyConfig = vi
      .fn<(args: ApplyConfigArgs) => Promise<{ outcome: 'restarted' | 'saved' }>>()
      .mockImplementation((args) =>
        Promise.resolve({ outcome: args.role === 'planner' ? 'restarted' : 'saved' })
      );

    const result = await applyFavoriteConfigsAndRestart(applyConfig, [plannerItem, builderItem]);

    expect(result).toEqual({
      applied: [
        {
          role: 'planner',
          entry: { agentHarness: 'claude-sdk', model: 'opus' },
          outcome: 'restarted',
        },
        {
          role: 'builder',
          entry: { agentHarness: 'opencode-sdk', model: 'gpt' },
          outcome: 'saved',
        },
      ],
      failed: [],
    });
  });

  it('reports one rejected apply and still applies the other roles', async () => {
    const applyConfig = vi
      .fn<(args: ApplyConfigArgs) => Promise<{ outcome: 'restarted' }>>()
      .mockImplementation((args) =>
        args.role === 'planner'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ outcome: 'restarted' })
      );

    const result = await applyFavoriteConfigsAndRestart(applyConfig, [plannerItem, builderItem]);

    expect(result.failed).toEqual([{ role: 'planner', message: 'boom' }]);
    expect(result.applied).toEqual([
      {
        role: 'builder',
        entry: { agentHarness: 'opencode-sdk', model: 'gpt' },
        outcome: 'restarted',
      },
    ]);
  });

  it('does nothing for an empty list', async () => {
    const applyConfig = vi.fn().mockResolvedValue({ outcome: 'unchanged' });

    const result = await applyFavoriteConfigsAndRestart(applyConfig, []);

    expect(applyConfig).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: [], failed: [] });
  });
});
