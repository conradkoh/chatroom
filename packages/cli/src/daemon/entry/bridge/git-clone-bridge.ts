/**
 * Builds the git clone job's ports from the daemon session. Argument mapping only, no logic.
 */

import { api } from '../../../api.js';
import type { GitCloneJobDeps } from '../../domain/usecase/run-git-clone-job.js';
import type { DaemonSessionServiceShape } from '../daemon-services.js';

export function createGitCloneJobDeps(
  session: DaemonSessionServiceShape,
  requestId: string
): GitCloneJobDeps {
  const base = { sessionId: session.sessionId, machineId: session.machineId, requestId };
  return {
    reportProgress: (p) =>
      session.backend.mutation(api.gitCloneRequests.reportProgress, {
        ...base,
        phase: p.phase,
        percent: p.percent,
      }),
    reportResult: (r) =>
      session.backend.mutation(api.gitCloneRequests.reportResult, { ...base, ...r }),
  };
}
