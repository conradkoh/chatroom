/**
 * OpenCodeSdkDriver — AgentToolDriver for the OpenCode SDK harness.
 *
 * Uses @opencode-ai/sdk to spin up an OpenCode server (headless), create a
 * session, and send the combined role + initial prompt as the first message.
 *
 * Session state (serverUrl + sessionId) is persisted via the DaemonAgentEntry
 * extension so recover() can reconnect after a daemon restart.
 *
 * Capabilities:
 * - sessionPersistence: true (serverUrl + sessionId persisted on disk)
 * - abort: true (session.abort())
 * - modelSelection: true (model forwarded via session.prompt)
 * - compaction: true (session.summarize())
 * - eventStreaming: false (not wired in this PR)
 * - messageInjection: false (not wired in this PR)
 * - dynamicModelDiscovery: true (provider.list() via SDK)
 *
 * SDK deviations from plan 023 architecture.md:
 * - createOpencode() is NOT exported; use createOpencodeServer() + createOpencodeClient()
 * - session.status() is global (not per-session); returns a map keyed by sessionId
 * - promptAsync() is the non-blocking variant; prompt() is synchronous/blocking
 */

import { createOpencodeClient } from '@opencode-ai/sdk';
import { createOpencodeServer } from '@opencode-ai/sdk/server';

import type {
  AgentCapabilities,
  AgentHandle,
  AgentStartOptions,
  AgentToolDriver,
} from './types.js';
import { persistSdkSession, loadSdkSession, clearSdkSession } from '../machine/daemon-state.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_START_TIMEOUT_MS = 30_000;

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface OpenCodeSdkDriverDeps {
  createServer: typeof createOpencodeServer;
  createClient: typeof createOpencodeClient;
}

// ─── Driver ──────────────────────────────────────────────────────────────────

export class OpenCodeSdkDriver implements AgentToolDriver {
  readonly harness = 'opencode-sdk' as const;

  readonly capabilities: AgentCapabilities = {
    sessionPersistence: true,
    abort: true,
    modelSelection: true,
    compaction: true,
    eventStreaming: false,
    messageInjection: false,
    dynamicModelDiscovery: true,
  };

  private readonly createServer: typeof createOpencodeServer;
  private readonly createClient: typeof createOpencodeClient;

  constructor(deps?: Partial<OpenCodeSdkDriverDeps>) {
    this.createServer = deps?.createServer ?? createOpencodeServer;
    this.createClient = deps?.createClient ?? createOpencodeClient;
  }

  async start(options: AgentStartOptions): Promise<AgentHandle> {
    const { workingDir, rolePrompt, initialMessage, model } = options;

    // Start (or reuse) an OpenCode server for this working directory
    const server = await this.createServer({
      timeout: SERVER_START_TIMEOUT_MS,
    });

    const client = this.createClient({ baseUrl: server.url });

    // Create a new session scoped to the working directory
    const createResult = await client.session.create({
      query: { directory: workingDir },
    });

    const session = createResult.data;
    if (!session) {
      server.close();
      throw new Error('Failed to create OpenCode SDK session: no session returned');
    }

    const sessionId = session.id;

    // Build model body — OpenCode uses "providerID/modelID" format
    let modelBody: { providerID: string; modelID: string } | undefined;
    if (model) {
      const slashIdx = model.indexOf('/');
      if (slashIdx !== -1) {
        modelBody = {
          providerID: model.substring(0, slashIdx),
          modelID: model.substring(slashIdx + 1),
        };
      }
    }

    // Send combined role prompt + initial message as the first user message
    const combinedPrompt = rolePrompt ? `${rolePrompt}\n\n${initialMessage}` : initialMessage;

    await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        ...(modelBody ? { model: modelBody } : {}),
        parts: [{ type: 'text', text: combinedPrompt }],
      },
    });

    const handle: AgentHandle = {
      harness: 'opencode-sdk',
      type: 'session',
      sessionId,
      serverUrl: server.url,
      workingDir,
    };

    // Persist for recover() — write after successful prompt send
    persistSdkSession(workingDir, { serverUrl: server.url, sessionId });

    return handle;
  }

  async stop(handle: AgentHandle): Promise<void> {
    if (!handle.sessionId || !handle.serverUrl) return;

    try {
      const client = this.createClient({ baseUrl: handle.serverUrl });
      await client.session.abort({ path: { id: handle.sessionId } });
    } catch {
      // Best-effort — if the server is already gone, ignore
    }
  }

  isAlive(handle: AgentHandle): boolean {
    // Synchronous check — we can only do a best-effort check using persisted state.
    // For the session handle to be considered alive, it must have both sessionId and serverUrl.
    // A deeper async check (actual HTTP call) is not possible in the sync interface.
    return !!(handle.sessionId && handle.serverUrl);
  }

  async listModels(): Promise<string[]> {
    try {
      // We need a server to query — attempt to create a temporary one
      const server = await this.createServer({ timeout: SERVER_START_TIMEOUT_MS });
      const client = this.createClient({ baseUrl: server.url });

      try {
        const result = await client.provider.list();
        const providers = result.data?.all ?? [];

        const models: string[] = [];
        for (const provider of providers) {
          for (const modelId of Object.keys(provider.models ?? {})) {
            models.push(`${provider.id}/${modelId}`);
          }
        }
        return models;
      } finally {
        server.close();
      }
    } catch {
      return [];
    }
  }

  /**
   * Attempt to recover a previously-running session for workingDir.
   * Reads persisted { serverUrl, sessionId } from disk and verifies the server
   * is still alive. Returns [] if the server is dead or no state is persisted.
   */
  async recover(workingDir: string): Promise<AgentHandle[]> {
    try {
      const persisted = loadSdkSession(workingDir);
      if (!persisted) return [];

      const { serverUrl, sessionId } = persisted;

      // Verify server is reachable by doing a lightweight call
      const client = this.createClient({ baseUrl: serverUrl });
      const result = await client.session.get({ path: { id: sessionId } });

      if (!result.data) return [];

      return [
        {
          harness: 'opencode-sdk',
          type: 'session',
          sessionId,
          serverUrl,
          workingDir,
        },
      ];
    } catch {
      // Server is dead or state is stale — clean up and return []
      try {
        clearSdkSession(workingDir);
      } catch {
        // ignore cleanup errors
      }
      return [];
    }
  }
}
