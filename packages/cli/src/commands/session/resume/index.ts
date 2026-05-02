/**
 * session resume — reattach to an existing harness session.
 */

import { resumeSession } from '../../../application/direct-harness/resume-session.js';
import type { ResumeSessionDeps } from '../../../application/direct-harness/resume-session.js';
import { getSessionId } from '../../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../../infrastructure/convex/client.js';
import { createOpencodeSdkHarness } from '../../../infrastructure/harnesses/opencode-sdk/index.js';
import { openCodeChunkExtractor } from '../../../infrastructure/harnesses/opencode-sdk/chunk-extractor.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionResumeOptions {
  /** Backend row ID of the session to resume. */
  harnessSessionRowId: string;
  /** Harness-issued session ID. */
  harnessSessionId: string;
  /** Harness to use. Default: 'opencode-sdk'. */
  harness?: string;
}

export interface SessionResumeDeps extends ResumeSessionDeps {
  readonly stdout: (line: string) => void;
  /** Optional override for the resumeSession implementation (for tests). */
  readonly resumeSessionImpl?: typeof resumeSession;
}

// ─── Default Deps Factory ─────────────────────────────────────────────────────

async function createDefaultDeps(): Promise<SessionResumeDeps> {
  const client = await getConvexClient();
  const sessionIdValue = getSessionId();

  if (!sessionIdValue) {
    throw new Error('Not authenticated');
  }

  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
    },
    sessionId: sessionIdValue,
    spawner: createOpencodeSdkHarness(),
    chunkExtractor: openCodeChunkExtractor,
    stdout: (line) => process.stdout.write(line + '\n'),
  };
}

// ─── Command implementation ───────────────────────────────────────────────────

/**
 * Resume an existing harness session.
 * Prints a confirmation line to stdout on success.
 */
export async function sessionResume(
  options: SessionResumeOptions,
  deps?: SessionResumeDeps
): Promise<void> {
  const sessionIdValue = getSessionId();
  if (!sessionIdValue) {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  let d: SessionResumeDeps;
  try {
    d = deps ?? (await createDefaultDeps());
  } catch {
    console.error('❌ Not authenticated. Please run: chatroom auth login');
    process.exit(1);
    return;
  }

  const { harnessSessionRowId, harnessSessionId } = options;

  const resumeFn = d.resumeSessionImpl ?? resumeSession;

  const handle = await resumeFn(d, { harnessSessionRowId, harnessSessionId });

  d.stdout(`resumed harnessSessionRowId: ${handle.harnessSessionRowId}`);
  d.stdout(`harnessSessionId: ${handle.harnessSessionId}`);

  process.exit(0);
}
