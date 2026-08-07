import type { SessionId } from 'convex-helpers/server/sessions';

import { promoteSessionToSystemAdmin } from './convex-client';

const SETUP_INSTRUCTIONS =
  'E2E admin seeding is not enabled on this Convex deployment.\n' +
  'Run: cd services/backend && npx convex env set E2E_SEEDING_ENABLED true\n' +
  'Ensure the deployment matches NEXT_PUBLIC_CONVEX_URL in apps/webapp/.env.local';

/**
 * Cold-start: the Playwright webServer probe only waits for Next.js, so the
 * first `convex dev` deploy (which pushes the seeding function asynchronously)
 * can still be in flight when admin tests begin. Treat a missing function as a
 * transient deploy race and retry briefly.
 */
const DEPLOY_RACE_TIMEOUT_MS = 60_000;
const RETRY_INTERVAL_MS = 2_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSeedingDisabled(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes('FORBIDDEN') || message.includes('E2E seeding is disabled');
}

function isDeployRace(error: unknown): boolean {
  return errorMessage(error).includes('Could not find public function');
}

/**
 * Fail-fast guard for the admin specs: verifies the E2E seeding mutation is
 * actually enabled on the Convex deployment before tests run, so a missing
 * `E2E_SEEDING_ENABLED` surfaces as an actionable error instead of an opaque
 * Convex FORBIDDEN rejection.
 *
 * The probe session is a real, already-authenticated session (the caller's own),
 * so when the gate is enabled the call succeeds and promotes it.
 */
export async function assertE2eSeedingEnabled(probeSessionId: SessionId): Promise<void> {
  const deadline = Date.now() + DEPLOY_RACE_TIMEOUT_MS;
  for (;;) {
    try {
      await promoteSessionToSystemAdmin(probeSessionId);
      return;
    } catch (error) {
      if (isSeedingDisabled(error)) {
        throw new Error(SETUP_INSTRUCTIONS);
      }
      if (isDeployRace(error) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
        continue;
      }
      throw error;
    }
  }
}
