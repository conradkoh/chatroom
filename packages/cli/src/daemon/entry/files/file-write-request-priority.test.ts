import { describe, expect, it } from 'vitest';

import type { PendingFileWriteRequest } from './file-write-fulfillment.js';
import {
  compareFileWriteRequestPriority,
  sortPendingFileWriteRequests,
} from './file-write-request-priority.js';

function makeRequest(
  _id: string,
  operation: PendingFileWriteRequest['operation'],
  storageId?: string
): PendingFileWriteRequest {
  return {
    _id,
    revision: 1,
    workingDir: '/w',
    filePath: `file-${_id}.txt`,
    operation,
    ...(storageId ? { storageId } : {}),
  };
}

describe('compareFileWriteRequestPriority', () => {
  it('ranks delete before a storage-backed create', () => {
    const del = makeRequest('req-del', 'delete');
    const storageCreate = makeRequest('req-up', 'create', 'storage-1');
    expect(compareFileWriteRequestPriority(del, storageCreate)).toBeLessThan(0);
    expect(compareFileWriteRequestPriority(storageCreate, del)).toBeGreaterThan(0);
  });

  it('ranks mkdir before a storage-backed upload', () => {
    const mkdir = makeRequest('req-mkdir', 'mkdir');
    const storageUpload = makeRequest('req-upload', 'create', 'storage-1');
    expect(compareFileWriteRequestPriority(mkdir, storageUpload)).toBeLessThan(0);
  });

  it('ranks rename before an inline create', () => {
    const rename = makeRequest('req-rename', 'rename');
    const inlineCreate = makeRequest('req-inline', 'create');
    expect(compareFileWriteRequestPriority(rename, inlineCreate)).toBeLessThan(0);
  });

  it('ranks inline writes before storage-backed uploads', () => {
    const inline = makeRequest('req-inline', 'update');
    const storage = makeRequest('req-storage', 'create', 'storage-1');
    expect(compareFileWriteRequestPriority(inline, storage)).toBeLessThan(0);
  });

  it('keeps FIFO order within the same priority tier', () => {
    const a = makeRequest('req-a', 'create');
    const b = makeRequest('req-b', 'create');
    expect(compareFileWriteRequestPriority(a, b)).toBeLessThan(0);
    expect(compareFileWriteRequestPriority(b, a)).toBeGreaterThan(0);
  });
});

describe('sortPendingFileWriteRequests', () => {
  it('does not mutate the input array', () => {
    const requests = [makeRequest('req-del', 'delete')];
    const sorted = sortPendingFileWriteRequests(requests);
    expect(sorted).not.toBe(requests);
    expect(requests).toHaveLength(1);
  });

  it('sorts fast ops first, then inline, then storage-backed', () => {
    const sorted = sortPendingFileWriteRequests([
      makeRequest('req-storage', 'create', 'storage-1'),
      makeRequest('req-inline', 'create'),
      makeRequest('req-del', 'delete'),
      makeRequest('req-mkdir', 'mkdir'),
      makeRequest('req-inline2', 'update'),
      makeRequest('req-storage2', 'update', 'storage-2'),
    ]);

    expect(sorted.map((r) => r._id)).toEqual([
      'req-del',
      'req-mkdir',
      'req-inline',
      'req-inline2',
      'req-storage',
      'req-storage2',
    ]);
  });
});
