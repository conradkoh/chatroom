/**
 * remote-unit-collector Unit Tests
 *
 * Mocks the S3b result-typed gh readers. Covers the failure contract (any `ok:false` fails the
 * whole collection), the unit order, the aggregate `checksState`, and the ref passed to checks.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { collectRemoteUnits } from './remote-unit-collector.js';
import {
  readCommitStatusChecks,
  readOpenPRsForBranch,
  type CommitStatusCheck,
} from '../../../infrastructure/git/git-reader.js';
import type { GitPullRequest } from '../../../infrastructure/git/types.js';

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  readOpenPRsForBranch: vi.fn(),
  readCommitStatusChecks: vi.fn(),
}));

const WORKING_DIR = '/repo';
const BRANCH = 'feat/x';

const PR: GitPullRequest = {
  prNumber: 42,
  title: 'Add collector',
  url: 'https://github.com/acme/repo/pull/42',
  headRefName: BRANCH,
  state: 'OPEN',
};

function checks(overrides: Partial<CommitStatusCheck> = {}): CommitStatusCheck {
  return {
    state: 'success',
    checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
    totalCount: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readOpenPRsForBranch).mockResolvedValue({ ok: true, value: [] });
  vi.mocked(readCommitStatusChecks).mockResolvedValue({ ok: true, value: null });
});

describe('collectRemoteUnits', () => {
  test('both readers ok: returns [pullRequests, checks] in that order with the aggregate state', async () => {
    vi.mocked(readOpenPRsForBranch).mockResolvedValue({ ok: true, value: [PR] });
    vi.mocked(readCommitStatusChecks).mockResolvedValue({ ok: true, value: checks() });

    const result = await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(result).toEqual({
      ok: true,
      units: [
        {
          kind: 'pullRequests',
          openPullRequests: [
            {
              prNumber: 42,
              title: 'Add collector',
              url: 'https://github.com/acme/repo/pull/42',
              headRefName: BRANCH,
              state: 'OPEN',
            },
          ],
        },
        {
          kind: 'checks',
          headCommitStatus: {
            state: 'success',
            checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
            totalCount: 1,
          },
        },
      ],
      checksState: 'success',
    });
  });

  test('PR reader fails: overall ok:false with its error', async () => {
    vi.mocked(readOpenPRsForBranch).mockResolvedValue({ ok: false, error: 'gh: rate limited' });
    vi.mocked(readCommitStatusChecks).mockResolvedValue({ ok: true, value: checks() });

    const result = await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(result).toEqual({ ok: false, error: 'gh: rate limited' });
  });

  test('checks reader fails: overall ok:false with its error', async () => {
    vi.mocked(readOpenPRsForBranch).mockResolvedValue({ ok: true, value: [PR] });
    vi.mocked(readCommitStatusChecks).mockResolvedValue({
      ok: false,
      error: 'check-runs: network down',
    });

    const result = await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(result).toEqual({ ok: false, error: 'check-runs: network down' });
  });

  test('checks with no runs: checksState is null even though the reader reports success', async () => {
    vi.mocked(readCommitStatusChecks).mockResolvedValue({
      ok: true,
      value: checks({ state: 'success', checkRuns: [], totalCount: 0 }),
    });

    const result = await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(result).toMatchObject({ ok: true, checksState: null });
  });

  test('no origin repo (checks value null): checks unit is null and checksState is null', async () => {
    const result = await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(result).toEqual({
      ok: true,
      units: [
        { kind: 'pullRequests', openPullRequests: [] },
        { kind: 'checks', headCommitStatus: null },
      ],
      checksState: null,
    });
  });

  test('pending run: checksState is pending', async () => {
    vi.mocked(readCommitStatusChecks).mockResolvedValue({
      ok: true,
      value: checks({
        state: 'pending',
        checkRuns: [
          { name: 'ci', status: 'completed', conclusion: 'success' },
          { name: 'deploy', status: 'in_progress', conclusion: null },
        ],
        totalCount: 2,
      }),
    });

    const result = await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(result).toMatchObject({ ok: true, checksState: 'pending' });
  });

  test('checks are read for the branch ref, the same value the git heartbeat passes', async () => {
    await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(readOpenPRsForBranch).toHaveBeenCalledWith(WORKING_DIR, BRANCH);
    expect(readCommitStatusChecks).toHaveBeenCalledWith(WORKING_DIR, BRANCH);
  });

  test('a PR without a number is dropped instead of published with an invalid value', async () => {
    vi.mocked(readOpenPRsForBranch).mockResolvedValue({
      ok: true,
      value: [
        { ...PR, prNumber: undefined },
        { ...PR, prNumber: 7, title: 'Kept' },
      ],
    });

    const result = await collectRemoteUnits(WORKING_DIR, BRANCH);

    expect(result).toMatchObject({
      ok: true,
      units: [
        {
          kind: 'pullRequests',
          openPullRequests: [expect.objectContaining({ prNumber: 7, title: 'Kept' })],
        },
        expect.anything(),
      ],
    });
  });
});
