/**
 * upsertWorkspaceGitState — headCommitStatus.checkRuns.{source,url} regression tests.
 *
 * In v1.38.7 we added two optional fields to each `CommitStatusCheckRun` entry
 * sent by the daemon:
 *   - `source: 'check-run' | 'status'` — discriminates modern Check Runs API
 *     entries from legacy Commit Statuses (e.g. Vercel deployments).
 *   - `url?: string | null` — passed through from the legacy Statuses API.
 *
 * The CLI was updated to send these fields but the backend mutation validator
 * still rejected them as extra fields, causing every git-state push from
 * v1.38.7 daemons to fail with `ArgumentValidationError`. This spec locks down
 * the validator so it accepts both shapes.
 *
 * Regression for: in-the-wild crash reported on 2026-05-13.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/upsert-git-state-headcommit-status-spec';

describe('upsertWorkspaceGitState — headCommitStatus.checkRuns optional fields', () => {
  test('accepts checkRuns entries with source and url (the v1.38.7 daemon shape)', async () => {
    const { sessionId } = await createTestSession('headcommitstatus-with-source-url');
    const machineId = 'headcommitstatus-with-source-url';
    await registerMachineWithDaemon(sessionId, machineId);

    // This payload is byte-for-byte the shape from the bug report:
    // a successful modern check-run AND a successful legacy commit-status.
    await expect(
      t.mutation(api.workspaces.upsertWorkspaceGitState, {
        sessionId: sessionId as any,
        machineId,
        workingDir: WORKING_DIR,
        status: 'available',
        branch: 'main',
        isDirty: false,
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        openPullRequests: [],
        allPullRequests: [],

        headCommitStatus: {
          state: 'success',
          totalCount: 2,
          checkRuns: [
            {
              name: 'Vercel Preview Comments',
              status: 'completed',
              conclusion: 'success',
              source: 'check-run',
            },
            {
              name: 'Vercel',
              status: 'completed',
              conclusion: 'success',
              source: 'status',
              url: 'https://vercel.com/example/deployment',
            },
          ],
        },
        defaultBranchStatus: null,
      })
    ).resolves.not.toThrow();
  });

  test('still accepts legacy checkRuns entries without source or url (v1.38.6 daemon shape)', async () => {
    const { sessionId } = await createTestSession('headcommitstatus-legacy-shape');
    const machineId = 'headcommitstatus-legacy-shape';
    await registerMachineWithDaemon(sessionId, machineId);

    // Older daemons that haven't been upgraded must keep working.
    await expect(
      t.mutation(api.workspaces.upsertWorkspaceGitState, {
        sessionId: sessionId as any,
        machineId,
        workingDir: WORKING_DIR,
        status: 'available',
        branch: 'main',
        isDirty: false,
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        openPullRequests: [],
        allPullRequests: [],

        headCommitStatus: {
          state: 'failure',
          totalCount: 1,
          checkRuns: [
            {
              name: 'copilot-setup-steps',
              status: 'completed',
              conclusion: 'failure',
            },
          ],
        },
        defaultBranchStatus: null,
      })
    ).resolves.not.toThrow();
  });

  test('also accepts the same shape on defaultBranchStatus', async () => {
    const { sessionId } = await createTestSession('defaultbranchstatus-with-source-url');
    const machineId = 'defaultbranchstatus-with-source-url';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.workspaces.upsertWorkspaceGitState, {
        sessionId: sessionId as any,
        machineId,
        workingDir: WORKING_DIR,
        status: 'available',
        branch: 'main',
        isDirty: false,
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        openPullRequests: [],
        allPullRequests: [],

        headCommitStatus: null,
        defaultBranchStatus: {
          state: 'success',
          totalCount: 1,
          checkRuns: [
            {
              name: 'deploy',
              status: 'completed',
              conclusion: 'success',
              source: 'check-run',
            },
          ],
        },
      })
    ).resolves.not.toThrow();
  });
});
