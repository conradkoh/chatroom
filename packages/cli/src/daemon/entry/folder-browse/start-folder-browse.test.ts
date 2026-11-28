import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startFolderBrowse } from './start-folder-browse.js';
import { api } from '../../../api.js';
import type { PendingFolderBrowse } from '../../domain/usecase/folder-browse-service.js';

type SubscriptionCallback = (rows: readonly PendingFolderBrowse[] | null) => void;

/**
 * End-to-end evidence for the daemon folder-browse path, with real filesystem and real service.
 * The only substitutions are the Convex client (subscription delivery) and the backend (mutation
 * sink). Both sit at the process boundary, so nothing internal is mocked.
 */
describe('startFolderBrowse', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chatroom-folder-browse-'));
    await mkdir(join(root, 'projects'));
    await writeFile(join(root, 'notes.txt'), 'x');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('lists a pending row from the filesystem and reports it through api.folderBrowse.reportListing', async () => {
    const reportListing = vi.fn(async (..._args: unknown[]) => ({ outcome: 'applied' }));
    const query = vi.fn();
    const backend = { mutation: reportListing, query };

    const unsubscribe = vi.fn();
    const callbacks: SubscriptionCallback[] = [];
    const onUpdate = vi.fn(
      (_query: unknown, _args: unknown, onUpdateCallback: SubscriptionCallback) => {
        callbacks.push(onUpdateCallback);
        return unsubscribe;
      }
    );

    const handle = startFolderBrowse({ sessionId: 's1', machineId: 'm1', backend }, {
      onUpdate,
    } as never);

    expect(onUpdate).toHaveBeenCalledOnce();
    const [subscribedFn, subscribedArgs] = onUpdate.mock.calls[0] ?? [];
    expect(getFunctionName(subscribedFn as never)).toBe(
      getFunctionName(api.folderBrowse.daemonPending)
    );
    expect(subscribedArgs).toEqual({ sessionId: 's1', machineId: 'm1' });

    callbacks[0]?.([{ browseId: 'b1', navSeq: 1, path: root, showHidden: false, filter: null }]);

    await vi.waitFor(() => expect(reportListing).toHaveBeenCalledOnce());
    expect(getFunctionName(reportListing.mock.calls[0]?.[0] as never)).toBe(
      getFunctionName(api.folderBrowse.reportListing)
    );
    expect(reportListing.mock.calls[0]?.[1]).toEqual({
      sessionId: 's1',
      machineId: 'm1',
      browseId: 'b1',
      navSeq: 1,
      result: {
        kind: 'listing',
        path: root,
        parentPath: dirname(root),
        entries: [{ name: 'projects' }],
        dirCount: 1,
        fileCount: 1,
        hiddenCount: 0,
        complete: true,
      },
    });
    // Nothing reads the machine command inbox: the backend is only ever used to report.
    expect(query).not.toHaveBeenCalled();

    handle.stop();
    expect(unsubscribe).toHaveBeenCalledOnce();

    callbacks[0]?.([{ browseId: 'b1', navSeq: 2, path: root, showHidden: false, filter: null }]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reportListing).toHaveBeenCalledOnce();
  });
});
