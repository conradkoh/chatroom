import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetWorkspaceFileTreeRefreshCoordinatorForTests,
  requestWorkspaceFileTreeRefresh,
} from './workspaceFileTreeRefreshCoordinator';
import { toWorkspaceFileTreeKey } from '../stores/workspaceFileTreeStore';

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/repo';
const KEY = toWorkspaceFileTreeKey(MACHINE_ID, WORKING_DIR);

beforeEach(() => {
  __resetWorkspaceFileTreeRefreshCoordinatorForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requestWorkspaceFileTreeRefresh', () => {
  it('dedupes refresh requests for the same workspace within the window', () => {
    const request = vi.fn();

    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      request,
    });
    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      request,
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('allows a second refresh after the dedup window', () => {
    const request = vi.fn();

    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      request,
    });

    vi.advanceTimersByTime(1500);

    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('dedupes across separate hook callers for the same workspace key', () => {
    const requestA = vi.fn();
    const requestB = vi.fn();

    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      request: requestA,
    });
    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      request: requestB,
    });

    expect(requestA).toHaveBeenCalledTimes(1);
    expect(requestB).not.toHaveBeenCalled();
  });

  it('bypasses dedup when force is true', () => {
    const request = vi.fn();

    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      force: true,
      request,
    });
    requestWorkspaceFileTreeRefresh({
      workspaceKey: KEY,
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      force: true,
      request,
    });

    expect(request).toHaveBeenCalledTimes(2);
  });
});
