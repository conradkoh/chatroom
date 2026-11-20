import type { BulkCreateResult } from '@workspace/backend/src/domain/usecase/chatroom/create-chatrooms-for-working-dirs';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_BULK_TOTALS,
  addBulkResult,
  bulkCreateDisabledReason,
  chatroomCount,
  planBulkCreate,
  repositoryCount,
} from './bulkCreate';

function paths(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `/r/repo-${String(index).padStart(3, '0')}`);
}

describe('planBulkCreate', () => {
  it('sends at most 50 per call and reports the remainder', () => {
    const all = paths(120);

    expect(planBulkCreate(all, 0)).toEqual({ batch: all.slice(0, 50), remaining: 70 });
    expect(planBulkCreate(all, 0).batch).toHaveLength(50);
    expect(planBulkCreate(all, 50)).toEqual({ batch: all.slice(50, 100), remaining: 20 });
    expect(planBulkCreate(all, 50).batch).toHaveLength(50);
    expect(planBulkCreate(all, 100)).toEqual({ batch: all.slice(100), remaining: 0 });
    expect(planBulkCreate(all, 100).batch).toHaveLength(20);
  });

  it('handles empty and exactly-full inputs', () => {
    expect(planBulkCreate([], 0)).toEqual({ batch: [], remaining: 0 });
    expect(planBulkCreate(paths(50), 0)).toEqual({ batch: paths(50), remaining: 0 });
    expect(planBulkCreate(paths(50), 0).batch).toHaveLength(50);
  });

  it('keeps list order across batches', () => {
    const all = paths(120);

    expect(planBulkCreate(all, 50).batch[0]).toBe('/r/repo-050');
    expect(planBulkCreate(all, 50).batch[49]).toBe('/r/repo-099');
  });
});

describe('addBulkResult', () => {
  it('starts the totals from an empty result', () => {
    expect(
      addBulkResult(EMPTY_BULK_TOTALS, { results: [], created: 48, skipped: 1, failed: 0 })
    ).toEqual({ created: 48, skipped: 1, failed: 0, failures: [] });
  });

  it('accumulates counts and maps each failure reason', () => {
    const first = addBulkResult(EMPTY_BULK_TOTALS, {
      results: [],
      created: 48,
      skipped: 1,
      failed: 0,
    });
    const second = addBulkResult(first, {
      results: [
        {
          workingDir: '/Users/me/projects/bad dir',
          outcome: 'failed',
          code: 'INVALID_WORKING_DIR',
          message: 'raw',
        },
      ],
      created: 0,
      skipped: 0,
      failed: 1,
    });

    expect(second).toEqual({
      created: 48,
      skipped: 1,
      failed: 1,
      failures: [
        {
          workingDir: '/Users/me/projects/bad dir',
          reason: "That path isn't valid. Use an absolute folder path such as /Users/you/projects.",
        },
      ],
    });
  });

  it('falls back to the backend message for an unknown failure code', () => {
    // Unknown codes are a forward-compatibility case: the backend union only carries
    // INVALID_WORKING_DIR today, so this pins the fallback for a future failure code.
    const result = {
      results: [
        {
          workingDir: '/Users/me/projects/oops',
          outcome: 'failed',
          code: 'SOMETHING',
          message: 'Backend says no',
        },
      ],
      created: 0,
      skipped: 0,
      failed: 1,
    } as unknown as BulkCreateResult;

    const totals = addBulkResult(EMPTY_BULK_TOTALS, result);

    expect(totals.failures[0]?.reason).toBe('Backend says no');
  });
});

describe('bulkCreateDisabledReason', () => {
  it('prefers offline, then unknown connectivity, then loading', () => {
    expect(bulkCreateDisabledReason({ connected: false, isLoadingPages: true })).toBe(
      'Machine is offline'
    );
    expect(bulkCreateDisabledReason({ connected: undefined, isLoadingPages: false })).toBe(
      'Checking machine…'
    );
    expect(bulkCreateDisabledReason({ connected: true, isLoadingPages: true })).toBe(
      'Loading repositories…'
    );
    expect(bulkCreateDisabledReason({ connected: true, isLoadingPages: false })).toBeNull();
  });
});

describe('repositoryCount', () => {
  it('pluralises repositories', () => {
    expect(repositoryCount(1)).toBe('1 repository');
    expect(repositoryCount(70)).toBe('70 repositories');
  });
});

describe('chatroomCount', () => {
  it('pluralises chatrooms', () => {
    expect(chatroomCount(1)).toBe('1 chatroom');
    expect(chatroomCount(50)).toBe('50 chatrooms');
  });
});
