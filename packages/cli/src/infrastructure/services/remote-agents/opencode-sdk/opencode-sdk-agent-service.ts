/**
 * OpenCodeSdkAgentService — concrete RemoteAgentService using the OpenCode SDK.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Uses @opencode-ai/sdk for session-based integration with OpenCode.
 * Spawns a local OpenCode server via child process, connects via SDK client,
 * and manages session lifecycle with the remote agent runtime.
 *
 * Extends BaseCLIAgentService which handles shared boilerplate:
 * process registry, stop/isAlive/getTrackedProcesses/untrack, and
 * isInstalled/getVersion helpers.
 */

import type { ChildProcess } from 'node:child_process';

import { createOpencodeClient } from '@opencode-ai/sdk';

import { buildAgentSpawnEnv } from '../../../convex/spawn-env.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { composeSystemPrompt } from './compose-system-prompt.js';
import type {
  SpawnContext,
  AgentStopOptions,
  DaemonHarnessSessionContext,
  HarnessReconnectMetadata,
  SpawnOptions,
  SpawnResult,
} from '../remote-agent-service.js';
import { forwardFiltered } from './node-streams.js';
import { waitForListeningUrl } from './parse-listening-url.js';
import { isInfoLine, parseModelId } from './pure.js';
import { selectAgent } from './select-agent.js';
import {
  startSessionEventForwarder,
  type SessionEventForwarderClient,
  type SessionEventForwarderHandle,
} from './session-event-forwarder.js';
import {
  FileSessionMetadataStore,
  type SessionMetadata,
  type SessionMetadataStore,
} from './session-metadata-store.js';
import { StderrLineBuffer } from './stderr-line-buffer.js';
import { matchesTerminalProviderErrorText } from '../../../../domain/agent-lifecycle/policies/terminal-provider-error.js';

export type OpenCodeSdkAgentServiceDeps = CLIAgentServiceDeps & {
  sessionMetadataStore?: SessionMetadataStore;
};

const OPENCODE_COMMAND = 'opencode';
const SERVE_STARTUP_TIMEOUT_MS = 10000;
const SESSION_CREATE_TIMEOUT_MS = 30_000;
const PROMPT_ASYNC_TIMEOUT_MS = 60_000;
const SESSION_ABORT_TIMEOUT_MS = 5_000;
const SESSION_GET_TIMEOUT_MS = 10_000;
const AGENTS_LIST_TIMEOUT_MS = 10_000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class OpenCodeSdkAgentService extends BaseCLIAgentService {
  /** Per-pid agent_end callbacks — preserved across in-turn session fallback. */
  private readonly agentEndCallbacksByPid = new Map<number, (() => void)[]>();
  readonly id = 'opencode-sdk';
  readonly displayName = 'OpenCode (SDK)';
  readonly command = OPENCODE_COMMAND;
  private readonly sessionStore: SessionMetadataStore;
  private readonly forwarders = new Map<number, SessionEventForwarderHandle>();

  constructor(deps?: Partial<OpenCodeSdkAgentServiceDeps>) {
    super(deps);
    this.sessionStore = deps?.sessionMetadataStore ?? new FileSessionMetadataStore();
  }

  async isInstalled(): Promise<boolean> {
    // The SDK is a runtime dependency of this CLI package (declared in our
    // package.json), so it's guaranteed to be present whenever this code
    // executes. The only meaningful gate is the `opencode` binary itself.
    //
    // Historical note: an earlier version called `require.resolve('@opencode-ai/sdk')`,
    // which throws ReferenceError in pure ESM (this CLI is `"type": "module"`),
    // silently returning false from the catch and hiding the harness from the
    // picker. The runtime check is unnecessary — the dependency contract handles it.
    return this.checkInstalled(OPENCODE_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return this.checkVersion(OPENCODE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Fall back to CLI
    const output = await this.runListCommand('opencode-sdk', `${OPENCODE_COMMAND} models`);

    if (output === null) return [];

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  override async stop(pid: number, options?: AgentStopOptions): Promise<void> {
    const forwarder = this.forwarders.get(pid);
    if (forwarder) {
      forwarder.stop();
      this.forwarders.delete(pid);
    }

    const preserveForResume = options?.preserveForResume === true;
    const meta = this.sessionStore.findByPid(pid);
    if (meta) {
      if (!preserveForResume) {
        try {
          const client = createOpencodeClient({ baseUrl: meta.baseUrl });
          await withTimeout(
            client.session.abort({ path: { id: meta.sessionId } }),
            SESSION_ABORT_TIMEOUT_MS,
            'session.abort'
          );
        } catch (err) {
          console.warn(
            `[opencode-sdk] session.abort for pid=${pid} sessionId=${meta.sessionId} failed (continuing with SIGTERM):`,
            err instanceof Error ? err.message : err
          );
        }
        // Eager cleanup: doStop may kill before the child exit handler runs; stale
        // pid-keyed metadata would otherwise block resumeTurn.
        this.sessionStore.remove(meta.sessionId);
      }
    }
    await super.stop(pid);
  }

  private spawnServeProcess(workingDir: string, resolvedConvexUrl: string): ChildProcess {
    const childProcess = this.deps.spawn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
      env: buildAgentSpawnEnv(resolvedConvexUrl),
    });

    if (!childProcess.pid) {
      throw new Error('Failed to spawn opencode serve process');
    }

    return childProcess;
  }

  private registerRunningSession(args: {
    childProcess: ChildProcess;
    pid: number;
    sessionId: string;
    context: SpawnContext;
    forwarder: SessionEventForwarderHandle | undefined;
    baseUrl: string;
    agentName: string;
    model: string | undefined;
    workingDir: string;
    logLineCallbacks: ((line: string) => void)[];
  }): SpawnResult {
    const {
      childProcess,
      pid,
      sessionId,
      context,
      forwarder,
      baseUrl,
      agentName,
      model,
      logLineCallbacks,
    } = args;

    const emitLogLine = (line: string) => {
      for (const lineCb of logLineCallbacks) lineCb(line);
    };

    const meta: SessionMetadata = {
      sessionId,
      machineId: context.machineId,
      chatroomId: context.chatroomId,
      role: context.role,
      agentName,
      ...(model ? { model } : {}),
      pid,
      createdAt: new Date().toISOString(),
      baseUrl,
    };
    this.sessionStore.upsert(meta);

    const entry = this.registerProcess(pid, context);
    if (forwarder) this.forwarders.set(pid, forwarder);

    const outputCallbacks: (() => void)[] = [];

    forwardFiltered(childProcess.stdout ?? undefined, process.stdout, isInfoLine);
    forwardFiltered(childProcess.stderr ?? undefined, process.stderr, isInfoLine);

    if (childProcess.stdout) {
      childProcess.stdout.on('data', () => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
      });
    }
    if (childProcess.stderr) {
      const stderrBuffer = new StderrLineBuffer((line) => {
        emitLogLine(line);
        const activeForwarder = this.forwarders.get(pid);
        if (activeForwarder && matchesTerminalProviderErrorText(line)) {
          activeForwarder.abortTerminalProviderError();
        }
      });
      childProcess.stderr.on('data', (chunk: Buffer | string) => {
        entry.lastOutputAt = Date.now();
        for (const cb of outputCallbacks) cb();
        stderrBuffer.append(chunk.toString());
      });
      childProcess.on('exit', () => {
        stderrBuffer.flush();
      });
    }

    return {
      pid,
      harnessSessionId: sessionId,
      harnessReconnect: {
        agentName,
        ...(model ? { model } : {}),
      },
      onExit: (cb) => {
        childProcess.on('exit', (code, signal) => {
          const fwd = this.forwarders.get(pid);
          if (fwd) {
            fwd.stop();
            this.forwarders.delete(pid);
          }
          this.sessionStore.remove(sessionId);
          this.agentEndCallbacksByPid.delete(pid);
          this.deleteProcess(pid);
          cb({ code, signal, context });
        });
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
      onAgentEnd: (cb) => {
        const callbacks = this.agentEndCallbacksByPid.get(pid) ?? [];
        callbacks.push(cb);
        this.agentEndCallbacksByPid.set(pid, callbacks);
        forwarder?.onAgentEnd(cb);
      },
      onLogLine: (cb) => {
        logLineCallbacks.push(cb);
      },
    };
  }

  private createLogLineEmitter(): {
    logLineCallbacks: ((line: string) => void)[];
    emitLogLine: (line: string) => void;
  } {
    const logLineCallbacks: ((line: string) => void)[] = [];
    return {
      logLineCallbacks,
      emitLogLine: (line: string) => {
        for (const cb of logLineCallbacks) cb(line);
      },
    };
  }

  /**
   * Best-effort in-turn recovery: create a new OpenCode session on an existing
   * serve process when resume on the prior sessionId fails.
   */
  private async startFreshSessionOnServe(args: {
    pid: number;
    baseUrl: string;
    context: SpawnContext;
    agentName: string;
    model?: string;
    prompt: string;
    oldSessionId?: string;
  }): Promise<void> {
    const existingForwarder = this.forwarders.get(args.pid);
    existingForwarder?.stop();
    this.forwarders.delete(args.pid);

    const client = createOpencodeClient({ baseUrl: args.baseUrl });

    const sessionCreateResult = await withTimeout(
      client.session.create({ body: {} }),
      SESSION_CREATE_TIMEOUT_MS,
      'session.create'
    );
    if (!sessionCreateResult.data?.id) {
      throw new Error('Failed to create session during resume fallback');
    }
    const newSessionId = sessionCreateResult.data.id;

    const forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
      sessionId: newSessionId,
      role: args.context.role,
    });

    const callbacks = this.agentEndCallbacksByPid.get(args.pid) ?? [];
    for (const cb of callbacks) {
      forwarder.onAgentEnd(cb);
    }
    this.forwarders.set(args.pid, forwarder);

    if (args.oldSessionId) {
      this.sessionStore.remove(args.oldSessionId);
    }
    this.sessionStore.upsert({
      sessionId: newSessionId,
      machineId: args.context.machineId,
      chatroomId: args.context.chatroomId,
      role: args.context.role,
      agentName: args.agentName,
      ...(args.model ? { model: args.model } : {}),
      pid: args.pid,
      createdAt: new Date().toISOString(),
      baseUrl: args.baseUrl,
    });

    const modelParts = args.model ? parseModelId(args.model) : undefined;
    await withTimeout(
      client.session.promptAsync({
        path: { id: newSessionId },
        body: {
          agent: args.agentName,
          parts: [{ type: 'text', text: args.prompt }],
          ...(modelParts ? { model: modelParts } : {}),
          tools: {
            task: false,
            question: false,
            external_directory: false,
          },
        },
      }),
      PROMPT_ASYNC_TIMEOUT_MS,
      'session.promptAsync'
    );
  }

  async resumeFromDaemonMemory(
    options: SpawnOptions,
    session: DaemonHarnessSessionContext
  ): Promise<SpawnResult> {
    const { prompt, systemPrompt, model, context } = options;
    const sessionId = session.harnessSessionId;
    const agentName = session.agentName;
    const modelForSession = model ?? session.model;
    const workingDir = session.workingDir;

    const childProcess = this.spawnServeProcess(workingDir, options.resolvedConvexUrl);
    const pid = childProcess.pid;
    if (pid == null) {
      throw new Error('Failed to spawn opencode serve process');
    }

    const baseUrl = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    }).catch((err) => {
      childProcess.kill();
      throw err;
    });

    const client = createOpencodeClient({ baseUrl });

    let forwarder: SessionEventForwarderHandle | undefined;
    const { logLineCallbacks, emitLogLine } = this.createLogLineEmitter();
    try {
      const sessionInfo = await withTimeout(
        client.session.get({ path: { id: sessionId } }),
        SESSION_GET_TIMEOUT_MS,
        'session.get'
      );
      if (!sessionInfo.data?.id) {
        throw new Error(
          `OpenCode session ${sessionId} not found (sessions may not survive serve restart)`
        );
      }

      forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
        sessionId,
        role: context.role,
        onLogLine: emitLogLine,
      });

      const agentsResponse = await withTimeout(
        client.app.agents(),
        AGENTS_LIST_TIMEOUT_MS,
        'app.agents'
      );
      const availableAgents = agentsResponse.data ?? [];
      const agentDef = availableAgents.find((a) => a.name === agentName);
      const composedSystem = composeSystemPrompt(agentDef?.prompt, systemPrompt);

      const modelParts = modelForSession ? parseModelId(modelForSession) : undefined;
      await withTimeout(
        client.session.promptAsync({
          path: { id: sessionId },
          body: {
            agent: agentName,
            ...(composedSystem ? { system: composedSystem } : {}),
            parts: [{ type: 'text', text: prompt }],
            ...(modelParts ? { model: modelParts } : {}),
            tools: {
              task: false,
              question: false,
              external_directory: false,
            },
          },
        }),
        PROMPT_ASYNC_TIMEOUT_MS,
        'session.promptAsync'
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${new Date().toISOString()}] role:${context.role} daemon-resume-fallback] ${reason} — cold spawning\n`
      );
      forwarder?.stop();
      childProcess.kill();
      return this.spawn(options);
    }

    return this.registerRunningSession({
      childProcess,
      pid,
      sessionId,
      context,
      forwarder,
      baseUrl,
      agentName,
      model: modelForSession,
      workingDir,
      logLineCallbacks,
    });
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const { prompt, systemPrompt, model, context } = options;

    const childProcess = this.spawnServeProcess(options.workingDir, options.resolvedConvexUrl);
    const pid = childProcess.pid;
    if (pid == null) {
      throw new Error('Failed to spawn opencode serve process');
    }

    const baseUrl = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    }).catch((err) => {
      childProcess.kill();
      throw err;
    });

    const client = createOpencodeClient({
      baseUrl,
    });

    let sessionId: string | undefined;
    let forwarder: SessionEventForwarderHandle | undefined;
    let agentName: string | undefined;
    const { logLineCallbacks, emitLogLine } = this.createLogLineEmitter();
    try {
      const sessionCreateResult = await withTimeout(
        client.session.create({ body: {} }),
        SESSION_CREATE_TIMEOUT_MS,
        'session.create'
      );

      if (!sessionCreateResult.data?.id) {
        throw new Error('Failed to create session');
      }

      sessionId = sessionCreateResult.data.id;

      forwarder = startSessionEventForwarder(client as SessionEventForwarderClient, {
        sessionId,
        role: context.role,
        onLogLine: emitLogLine,
      });

      // Discover what agents this opencode server actually exposes. We compose
      // against the runtime list rather than hard-coding names because (a) the
      // server caches its registry at startup, so client.config.update is a no-op
      // for runtime registration, and (b) the agent set is user-configurable.
      const agentsResponse = await withTimeout(
        client.app.agents(),
        AGENTS_LIST_TIMEOUT_MS,
        'app.agents'
      );
      const availableAgents = agentsResponse.data ?? [];
      const selected = selectAgent(availableAgents);
      agentName = selected.name;
      const composedSystem = composeSystemPrompt(selected.prompt, systemPrompt);

      const modelParts = model ? parseModelId(model) : undefined;
      await withTimeout(
        client.session.promptAsync({
          path: { id: sessionId },
          body: {
            agent: selected.name,
            ...(composedSystem ? { system: composedSystem } : {}),
            parts: [{ type: 'text', text: prompt }],
            ...(modelParts ? { model: modelParts } : {}),
            // Disable sub-agent spawning (task), questioning (question), and
            // external tool delegation (external_directory) for the SDK-based
            // opencode harness. These tools are not supported in the current
            // integration and would fail or behave unexpectedly if enabled.
            tools: {
              task: false,
              question: false,
              external_directory: false,
            },
          },
        }),
        PROMPT_ASYNC_TIMEOUT_MS,
        'session.promptAsync'
      );
    } catch (err) {
      // Surface a human-readable, role-prefixed reason to the daemon log before
      // tearing down. The daemon already pipes our stderr through; we match the
      // formatting style used by SessionEventForwarder so operators see one
      // consistent log shape regardless of failure source.
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${new Date().toISOString()}] role:${context.role} spawn-error] ${reason}\n`
      );
      forwarder?.stop();
      childProcess.kill();
      if (sessionId) this.sessionStore.remove(sessionId);
      throw err;
    }

    if (!sessionId || !agentName) {
      throw new Error('OpenCode session was not initialized');
    }

    return this.registerRunningSession({
      childProcess,
      pid,
      sessionId,
      context,
      forwarder,
      baseUrl,
      agentName,
      model,
      workingDir: options.workingDir,
      logLineCallbacks,
    });
  }

  getHarnessReconnectContext(pid: number): HarnessReconnectMetadata | undefined {
    const meta = this.sessionStore.findByPid(pid);
    if (!meta) {
      return undefined;
    }
    return {
      agentName: meta.agentName,
      ...(meta.model ? { model: meta.model } : {}),
    };
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const meta = this.sessionStore.findByPid(pid);
    if (!meta) {
      process.stderr.write(
        `[${new Date().toISOString()}] opencode-sdk resumeTurn: no metadata for pid=${pid}, skipping\n`
      );
      return;
    }

    const client = createOpencodeClient({ baseUrl: meta.baseUrl });
    const modelParts = meta.model ? parseModelId(meta.model) : undefined;
    const context: SpawnContext = {
      machineId: meta.machineId,
      chatroomId: meta.chatroomId,
      role: meta.role,
    };

    try {
      await withTimeout(
        client.session.promptAsync({
          path: { id: meta.sessionId },
          body: {
            agent: meta.agentName,
            parts: [{ type: 'text', text: prompt }],
            ...(modelParts ? { model: modelParts } : {}),
            tools: {
              task: false,
              question: false,
              external_directory: false,
            },
          },
        }),
        PROMPT_ASYNC_TIMEOUT_MS,
        'session.promptAsync'
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${new Date().toISOString()}] role:${meta.role} resume-fallback] ${reason} — starting fresh session\n`
      );
      await this.startFreshSessionOnServe({
        pid,
        baseUrl: meta.baseUrl,
        context,
        agentName: meta.agentName,
        model: meta.model,
        prompt,
        oldSessionId: meta.sessionId,
      });
    }
  }
}
