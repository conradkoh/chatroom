/**
 * opencode-sdk DirectHarness adapter.
 *
 * Implements DirectHarnessSpawner by composing against the existing
 * opencode-sdk utility functions without modifying OpenCodeSdkAgentService.
 *
 * Key design choices:
 * - spawn() starts the server and creates a session WITHOUT sending any
 *   initial prompt. Callers use send() for messages.
 * - Sessions are persisted via FileSessionMetadataStore so resume() works
 *   across daemon restarts (same as OpenCodeSdkAgentService does for pids).
 * - Events are forwarded via raw client.event.subscribe() loop to avoid
 *   double-subscribing to the same stream as SessionEventForwarder.
 * - close() on a spawned session removes the store entry; resume() sessions
 *   leave it intact so the original spawner can still manage the process.
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
  FileSessionMetadataStore,
  type SessionMetadataStore,
} from '../../services/remote-agents/opencode-sdk/session-metadata-store.js';

import {
  OpencodeSdkDirectHarnessSession,
  subscribeToSessionEvents,
  type OpencodeSdkSessionClient,
} from './session.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for creating the opencode-sdk harness spawner. */
export interface CreateOpencodeSdkHarnessOptions {
  /** Server startup timeout in ms. Default: 10 000 */
  readonly startupTimeoutMs?: number;
  /** Override the spawn function (for tests). */
  readonly spawnFn?: typeof nodeSpawn;
  /** Override Date.now (for tests). */
  readonly nowFn?: () => number;
  /**
   * Session persistence store.
   * Defaults to FileSessionMetadataStore so sessions survive daemon restarts.
   * Inject InMemorySessionMetadataStore in tests.
   */
  readonly sessionStore?: SessionMetadataStore;
}

/** Fields required in SpawnOptions.config for opencode-sdk sessions. */
interface OpencodeSdkSpawnConfig {
  chatroomId: string;
  role: string;
  machineId: string;
}

const OPENCODE_COMMAND = 'opencode';
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a DirectHarnessSpawner for the opencode SDK harness.
 *
 * Returns a plain object — no class required at the spawner boundary.
 * The spawner uses the injected (or default) SessionMetadataStore for
 * cross-restart session resumption.
 */
export function createOpencodeSdkHarness(
  options: CreateOpencodeSdkHarnessOptions = {}
): DirectHarnessSpawner {
  const {
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    spawnFn = nodeSpawn,
    nowFn = Date.now,
    sessionStore = new FileSessionMetadataStore(),
  } = options;

  return {
    harnessName: 'opencode-sdk',

    async spawn(spawnOptions: SpawnOptions): Promise<DirectHarnessSession> {
      // ── Validate required config fields ──────────────────────────────────
      const config = (spawnOptions.config ?? {}) as Partial<OpencodeSdkSpawnConfig>;
      if (!config.chatroomId || !config.role || !config.machineId) {
        throw new Error(
          'opencode-sdk spawn() requires chatroomId, role, and machineId in SpawnOptions.config'
        );
      }
      const { chatroomId, role, machineId } = config as OpencodeSdkSpawnConfig;

      const cwd = spawnOptions.cwd ?? process.cwd();
      const env = {
        ...process.env,
        ...(spawnOptions.env ?? {}),
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
      };

      // ── 1. Start the opencode serve process ──────────────────────────────
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

      // ── 2. Wait for the server to start listening ─────────────────────────
      const baseUrl = await waitForListeningUrl(childProcess, {
        timeoutMs: startupTimeoutMs,
      }).catch((err: unknown) => {
        childProcess.kill();
        throw err;
      });

      // ── 3. Create the SDK client and a new bare session (no prompt sent) ─
      const sdkClient = createOpencodeClient({ baseUrl });

      let sdkSessionId: string;
      try {
        const result = await sdkClient.session.create({ body: {} });
        const sessionId = result.data?.id;
        if (!sessionId) throw new Error('Failed to create session: missing id');
        sdkSessionId = sessionId;
      } catch (err) {
        childProcess.kill();
        throw err;
      }

      // sdkClient satisfies OpencodeSdkSessionClient structurally
      const client: OpencodeSdkSessionClient = sdkClient;

      const harnessSessionId = sdkSessionId as HarnessSessionId;

      // ── 4. Persist session for resume() across daemon restarts ────────────
      sessionStore.upsert({
        sessionId: sdkSessionId,
        machineId,
        chatroomId,
        role,
        pid,
        createdAt: new Date(nowFn()).toISOString(),
        baseUrl,
      });

      // ── 5. Build the session with a lazy stopEventStream closure ──────────
      let stopEventStream: () => void = () => {};

      const session = new OpencodeSdkDirectHarnessSession(
        harnessSessionId,
        client,
        () => stopEventStream(),
        () => {
          sessionStore.remove(sdkSessionId);
          childProcess.kill();
        },
      );

      // ── 6. Start event subscription in the background ─────────────────────
      stopEventStream = subscribeToSessionEvents(client, session, nowFn);

      return session;
    },

    async resume(harnessSessionId: HarnessSessionId): Promise<DirectHarnessSession> {
      const meta = sessionStore.get(harnessSessionId as string);
      if (!meta) {
        throw new Error(
          `Cannot resume harnessSessionId=${harnessSessionId}: not found in session store. ` +
          `Ensure the harness was spawned with this instance or the store file is accessible.`
        );
      }

      const client: OpencodeSdkSessionClient = createOpencodeClient({ baseUrl: meta.baseUrl });

      let stopEventStream: () => void = () => {};

      // Resumed sessions do NOT own the process — no killProcess callback
      const session = new OpencodeSdkDirectHarnessSession(
        harnessSessionId,
        client,
        () => stopEventStream(),
        undefined,
      );

      stopEventStream = subscribeToSessionEvents(client, session, nowFn);

      return session;
    },
  };
}
