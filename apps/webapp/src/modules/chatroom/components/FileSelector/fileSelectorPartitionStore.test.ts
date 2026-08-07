import { describe, expect, it, beforeEach } from 'vitest';

import {
  acquireFileSelectorPartition,
  beginFileSelectorPreload,
  commitFileSelectorPreload,
  getFileSelectorPartitionForTests,
  getFileSelectorPartitionRefCountForTests,
  getFileSelectorPreloadFiles,
  releaseFileSelectorPartition,
  resetFileSelectorPartitionRegistryForTests,
} from './fileSelectorPartitionStore';
import type { FileEntry } from './useFileSelector';

const sampleFiles: FileEntry[] = [{ path: 'src/index.ts', type: 'file' }];

describe('fileSelectorPartitionStore', () => {
  beforeEach(() => {
    resetFileSelectorPartitionRegistryForTests();
  });

  it('acquire increments refCount and release deletes at zero', () => {
    acquireFileSelectorPartition('room-1', 'machine-1', '/workspace');
    expect(getFileSelectorPartitionRefCountForTests('room-1', 'machine-1', '/workspace')).toBe(1);

    acquireFileSelectorPartition('room-1', 'machine-1', '/workspace');
    expect(getFileSelectorPartitionRefCountForTests('room-1', 'machine-1', '/workspace')).toBe(2);

    releaseFileSelectorPartition('room-1', 'machine-1', '/workspace');
    expect(getFileSelectorPartitionRefCountForTests('room-1', 'machine-1', '/workspace')).toBe(1);
    expect(getFileSelectorPartitionForTests('room-1', 'machine-1', '/workspace')).toBeDefined();

    releaseFileSelectorPartition('room-1', 'machine-1', '/workspace');
    expect(getFileSelectorPartitionForTests('room-1', 'machine-1', '/workspace')).toBeUndefined();
  });

  it('generation guard discards stale commit', () => {
    const state$ = acquireFileSelectorPartition('room-1', 'machine-1', '/workspace');
    const gen1 = beginFileSelectorPreload(state$);
    beginFileSelectorPreload(state$);
    commitFileSelectorPreload(state$, gen1, sampleFiles);

    expect(getFileSelectorPreloadFiles(state$.partitionKey.get())).toEqual([]);
    expect(state$.status.get()).toBe('loading');
  });

  it('commit applies files when generation matches', () => {
    const state$ = acquireFileSelectorPartition('room-1', 'machine-1', '/workspace');
    const generation = beginFileSelectorPreload(state$);
    commitFileSelectorPreload(state$, generation, sampleFiles);

    expect(getFileSelectorPreloadFiles(state$.partitionKey.get())).toEqual(sampleFiles);
    expect(state$.status.get()).toBe('ready');
  });

  it('two partitions for different keys do not cross-contaminate', () => {
    const stateA$ = acquireFileSelectorPartition('room-1', 'machine-a', '/workspace');
    const stateB$ = acquireFileSelectorPartition('room-1', 'machine-b', '/workspace');

    const genA = beginFileSelectorPreload(stateA$);
    const genB = beginFileSelectorPreload(stateB$);
    commitFileSelectorPreload(stateA$, genA, sampleFiles);
    commitFileSelectorPreload(stateB$, genB, []);

    expect(getFileSelectorPreloadFiles(stateA$.partitionKey.get())).toEqual(sampleFiles);
    expect(getFileSelectorPreloadFiles(stateB$.partitionKey.get())).toEqual([]);
    expect(stateA$.partitionKey.get()).not.toBe(stateB$.partitionKey.get());
  });
});
