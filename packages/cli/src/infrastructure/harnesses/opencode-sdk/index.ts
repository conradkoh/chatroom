/**
 * opencode-sdk DirectHarness adapter.
 *
 * Implements DirectHarnessSpawner by composing against the existing
 * opencode-sdk utility functions without modifying the existing
 * OpenCodeSdkAgentService. The adapter handles process lifecycle,
 * session creation, and event subscription independently.
 *
 * Key design choices:
 * - spawn() starts the server and creates a session WITHOUT sending any
 *   initial prompt (unlike OpenCodeSdkAgentService which sends the first
 *   prompt atomically). Callers use send() for messages.
 * - resume() reconnects to a previously spawned session using the
 *   in-memory metadata store (populated on spawn).
 * - Events are forwarded via a raw client.event.subscribe() loop without
 *   going through SessionEventForwarder (avoids double-subscription).
 *
 * Limitation: resume() is in-memory only — sessions survive hot reconnects
 * within the same daemon run but are lost on daemon restart. File-based
 * persistence can be added in a follow-up commit.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';

import type {
  DirectHarnessSpawner,
  DirectHarnessSession,
  SpawnOptions,
  HarnessSessionId,
} from '../../../domain/direct-harness/index.js';

import { waitForListeningUrl } from '../../services/remote-agents/opencode-sdk/parse-listening-url.js';

import {
  OpencodeSdkDirectHarnessSession,
  subscribeToSessionEvents,
} from './session.js';

// ─── Internal session metadata ────────────────────────────────────────────────

interface HarnessSessionEntry {
  harnessSessionId: HarnessSessionId;
  baseUrl: string;
  pid: number;
}

/** Options for creating the opencode-sdk harness spawner. */
export interface CreateOpencodeSdkHarnessOptions {
  /** Server startup timeout in ms. Default: 10 000 */
  readonly startupTimeoutMs?: number;
  /** Override the spawn function (for tests). */
  readonly spawnFn?: typeof nodeSpawn;
  /** Override Date.now (for tests). */
  readonly nowFn?: () => number;
}

const OPENCODE_COMMAND = 'opencode';
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

/**
 * Creates a DirectHarnessSpawner for the opencode SDK harness.
 *
 * Returns a plain object — no class required at the spawner boundary.
 * Each returned spawner maintains its own in-memory session registry.
 */
export function createOpencodeSdkHarness(
  options: CreateOpencodeSdkHarnessOptions = {}
): DirectHarnessSpawner {
  const {
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    spawnFn = nodeSpawn,
    nowFn = Date.now,
  } = options;

  // In-memory registry of active sessions keyed by harnessSessionId string
  const sessions = new Map<string, HarnessSessionEntry>();

  return {
    harnessName: 'opencode-sdk',

    async spawn(_spawnOptions: SpawnOptions): Promise<DirectHarnessSession> {
      const cwd = _spawnOptions.cwd ?? process.cwd();
      const env = {
        ...process.env,
        ...(_spawnOptions.env ?? {}),
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      };

      // 1. Start the opencode serve process
      const childProcess = spawnFn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        detached: true,
      });

      if (!childProcess.pid) {
        throw new Error('Failed to spawn opencode serve process');
      }

      const pid = childProcess.pid;

      // 2. Wait for the server to start listening
      const baseUrl = await waitForListeningUrl(childProcess, {
        timeoutMs: startupTimeoutMs,
      }).catch((err) => {
        childProcess.kill();
        throw err;
      });

      // 3. Create the SDK client and a new bare session (no initial prompt)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = createOpencodeClient({ baseUrl }) as any;

      let sdkSessionId: string;
      try {
        const result = await client.session.create({ body: {} });
        if (!result.data?.id) throw new Error('Failed to create session: missing id');
        sdkSessionId = result.data.id;
      } catch (err) {
        childProcess.kill();
        throw err;
      }

      const harnessSessionId = sdkSessionId as HarnessSessionId;

      // 4. Store session entry so resume() can find the baseUrl
      sessions.set(sdkSessionId, { harnessSessionId, baseUrl, pid });

      // 5. Build the session with a lazy stopEventStream closure so we can
      //    inject the actual stop function after the subscription starts
      let stopEventStream: () => void = () => {};

      const session = new OpencodeSdkDirectHarnessSession(
        harnessSessionId,
        client,
        () => stopEventStream(), // proxy — calls the real stop function when set
        () => {
          sessions.delete(sdkSessionId);
          childProcess.kill();
        },
      );

      // 6. Start the event subscription and capture the stop function
      stopEventStream = subscribeToSessionEvents(client, session, nowFn);

      return session;
    },

    async resume(harnessSessionId: HarnessSessionId): Promise<DirectHarnessSession> {
      const entry = sessions.get(harnessSessionId as string);
      if (!entry) {
        throw new Error(
          `Cannot resume harnessSessionId=${harnessSessionId}: not found in registry. ` +
          `Resume is supported within the same daemon run only (in-memory registry).`
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = createOpencodeClient({ baseUrl: entry.baseUrl }) as any;

      let stopEventStream: () => void = () => {};

      const session = new OpencodeSdkDirectHarnessSession(
        harnessSessionId,
        client,
        () => stopEventStream(),
        undefined, // don't kill process on resume — spawner manages process lifecycle
      );

      stopEventStream = subscribeToSessionEvents(client, session, nowFn);

      return session;
    },
  };
}
