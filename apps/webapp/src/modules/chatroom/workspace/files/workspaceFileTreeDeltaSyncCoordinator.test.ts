import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests,
  acquireFileTreeDeltaSync,
  isFileTreeDeltaSyncActive,
  isFileTreeDeltaSyncOwner,
  releaseFileTreeDeltaSync,
} from './workspaceFileTreeDeltaSyncCoordinator';

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/workspace';

beforeEach(() => {
  __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests();
});

describe('workspaceFileTreeDeltaSyncCoordinator', () => {
  it('assigns ownership to the first consumer per workspace', () => {
    const first = Symbol('first');
    const second = Symbol('second');

    acquireFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, first);
    acquireFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, second);

    expect(isFileTreeDeltaSyncOwner(MACHINE_ID, WORKING_DIR, first)).toBe(true);
    expect(isFileTreeDeltaSyncOwner(MACHINE_ID, WORKING_DIR, second)).toBe(false);
  });

  it('hands ownership to the next consumer when the owner releases', () => {
    const first = Symbol('first');
    const second = Symbol('second');

    acquireFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, first);
    acquireFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, second);
    releaseFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, first);

    expect(isFileTreeDeltaSyncOwner(MACHINE_ID, WORKING_DIR, second)).toBe(true);
  });

  it('clears active state and owner queue after all consumers release', () => {
    const first = Symbol('first');
    const second = Symbol('second');

    acquireFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, first);
    acquireFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, second);
    releaseFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, first);
    releaseFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, second);

    expect(isFileTreeDeltaSyncActive(MACHINE_ID, WORKING_DIR)).toBe(false);
    expect(isFileTreeDeltaSyncOwner(MACHINE_ID, WORKING_DIR, second)).toBe(false);
  });

  it('clears state when reset for tests', () => {
    const owner = Symbol('owner');

    acquireFileTreeDeltaSync(MACHINE_ID, WORKING_DIR, owner);
    __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests();

    expect(isFileTreeDeltaSyncActive(MACHINE_ID, WORKING_DIR)).toBe(false);
    expect(isFileTreeDeltaSyncOwner(MACHINE_ID, WORKING_DIR, owner)).toBe(false);
  });
});
