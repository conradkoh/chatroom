import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetTrackedWorkspaceFilesStoreForTests,
  toTrackedWorkspaceKey,
  upsertTrackedDirListing,
} from './trackedWorkspaceFilesStore';
import { useTrackedWorkspaceFiles } from './useTrackedWorkspaceFiles';

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/repo';
const KEY = toTrackedWorkspaceKey(MACHINE_ID, WORKING_DIR);

beforeEach(() => {
  __resetTrackedWorkspaceFilesStoreForTests();
});

describe('useTrackedWorkspaceFiles', () => {
  it('updates when the tracked store receives new listings', () => {
    const { result } = renderHook(() => useTrackedWorkspaceFiles(MACHINE_ID, WORKING_DIR, true));

    expect(result.current).toEqual([]);

    act(() => {
      upsertTrackedDirListing(KEY, 'src/auth', [
        { name: 'login.ts', path: 'src/auth/login.ts', type: 'file' },
      ]);
    });

    expect(result.current).toEqual([{ path: 'src/auth/login.ts', type: 'file' }]);
  });
});
