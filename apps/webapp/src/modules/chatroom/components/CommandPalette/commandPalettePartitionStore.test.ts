import { describe, expect, it, beforeEach } from 'vitest';

import {
  acquireCommandPalettePartition,
  commitCommandPalettePreload,
  beginCommandPalettePreload,
  getCommandPalettePartitionForTests,
  getCommandPalettePartitionRefCountForTests,
  releaseCommandPalettePartition,
  resetCommandPalettePartitionRegistryForTests,
} from './commandPalettePartitionStore';
import type { CommandPaletteRow } from './commandPaletteRows';

const sampleRows: CommandPaletteRow[] = [{ type: 'heading', id: 'h1', label: 'Commands' }];

describe('commandPalettePartitionStore', () => {
  beforeEach(() => {
    resetCommandPalettePartitionRegistryForTests();
  });

  it('acquire increments refCount and release deletes at zero', () => {
    acquireCommandPalettePartition('room-1', 'ws-1');
    expect(getCommandPalettePartitionRefCountForTests('room-1', 'ws-1')).toBe(1);

    acquireCommandPalettePartition('room-1', 'ws-1');
    expect(getCommandPalettePartitionRefCountForTests('room-1', 'ws-1')).toBe(2);

    releaseCommandPalettePartition('room-1', 'ws-1');
    expect(getCommandPalettePartitionRefCountForTests('room-1', 'ws-1')).toBe(1);
    expect(getCommandPalettePartitionForTests('room-1', 'ws-1')).toBeDefined();

    releaseCommandPalettePartition('room-1', 'ws-1');
    expect(getCommandPalettePartitionForTests('room-1', 'ws-1')).toBeUndefined();
  });

  it('generation guard discards stale commit', () => {
    const state$ = acquireCommandPalettePartition('room-1', 'ws-1');
    const gen1 = beginCommandPalettePreload(state$);
    beginCommandPalettePreload(state$);
    commitCommandPalettePreload(state$, gen1, sampleRows);

    expect(state$.browseRows.get()).toEqual([]);
    expect(state$.status.get()).toBe('loading');
  });

  it('commit applies rows when generation matches', () => {
    const state$ = acquireCommandPalettePartition('room-1', 'ws-1');
    const generation = beginCommandPalettePreload(state$);
    commitCommandPalettePreload(state$, generation, sampleRows);

    expect(state$.browseRows.get()).toEqual(sampleRows);
    expect(state$.status.get()).toBe('ready');
  });

  it('two partitions for different keys do not cross-contaminate', () => {
    const stateA$ = acquireCommandPalettePartition('room-1', 'ws-a');
    const stateB$ = acquireCommandPalettePartition('room-1', 'ws-b');

    const genA = beginCommandPalettePreload(stateA$);
    const genB = beginCommandPalettePreload(stateB$);
    commitCommandPalettePreload(stateA$, genA, sampleRows);
    commitCommandPalettePreload(stateB$, genB, []);

    expect(stateA$.browseRows.get()).toEqual(sampleRows);
    expect(stateB$.browseRows.get()).toEqual([]);
    expect(stateA$.partitionKey.get()).not.toBe(stateB$.partitionKey.get());
  });
});
