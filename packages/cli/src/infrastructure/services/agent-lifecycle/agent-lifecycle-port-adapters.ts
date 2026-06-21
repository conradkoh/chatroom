/**
 * AgentLifecyclePortAdapters — bridges AgentProcessManager dependencies
 * to the AgentLifecyclePorts interface.
 *
 * Provides factory functions that wrap existing APM services
 * (HarnessSpawningService, RemoteAgentService map) into the Effect-based
 * ports expected by AgentLifecycleService.
 */

import { Effect } from 'effect';

import type { AgentLifecyclePorts, SpawnPort, HarnessSpawnPort } from './agent-lifecycle-types.js';
import { isProcessAlive } from '../../deps/process.js';
import type { AgentHarness } from '../../machine/types.js';
import type { RemoteAgentService, SpawnResult } from '../remote-agents/remote-agent-service.js';
import type { SpawnPrompt } from '../remote-agents/spawn-prompt.js';

// ─── Port Adapter Dependencies ────────────────────────────────────────────────

export interface AgentLifecyclePortAdapterDeps {
  readonly spawning: {
    readonly shouldAllowSpawn: (
      chatroomId: string,
      reason: string
    ) => { allowed: boolean; retryAfterMs?: number };
  };
  readonly agentServices: Map<string, RemoteAgentService>;
  readonly sessionId: string;
  readonly machineId: string;
  readonly convexUrl: string;
  /** Called when harness reports agent_end for a slot. */
  readonly onAgentEnd: (args: {
    chatroomId: string;
    role: string;
    pid: number;
    harness: AgentHarness;
  }) => void;
}

// ─── Spawn Port Adapter ───────────────────────────────────────────────────────

export function createSpawnPort(spawning: AgentLifecyclePortAdapterDeps['spawning']): SpawnPort {
  return {
    shouldAllowSpawn: (chatroomId, reason) => spawning.shouldAllowSpawn(chatroomId, reason),
  };
}

// ─── Harness Spawn Port Adapter ───────────────────────────────────────────────

export function createHarnessSpawnPort(deps: AgentLifecyclePortAdapterDeps): HarnessSpawnPort {
  return {
    spawn: (args) =>
      Effect.tryPromise({
        try: async () => {
          const service = deps.agentServices.get(args.harness);
          if (!service) {
            throw new Error(`Unknown agent harness: ${args.harness}`);
          }
          const result: SpawnResult = await service.spawn({
            workingDir: args.workingDir,
            prompt: args.prompt as SpawnPrompt,
            systemPrompt: args.systemPrompt ?? '',
            model: args.model,
            context: {
              machineId: deps.machineId,
              chatroomId: args.chatroomId,
              role: args.role,
            },
            resolvedConvexUrl: deps.convexUrl,
          });
          return {
            pid: result.pid,
            harnessSessionId: result.harnessSessionId,
            onAgentEnd: (cb: () => void) => {
              result.onAgentEnd?.(cb);
            },
            onLogLine: result.onLogLine
              ? (lineCb: (line: string) => void) => {
                  result.onLogLine?.((line: string) => {
                    lineCb(line);
                  });
                }
              : undefined,
          };
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    stop: (pid, opts) =>
      Effect.tryPromise({
        try: async () => {
          // Find service that owns pid — delegate to APM's existing stop logic pattern
          for (const service of deps.agentServices.values()) {
            try {
              await service.stop(pid, opts);
              return;
            } catch {
              // try next
            }
          }
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    isAlive: (pid) =>
      Effect.sync(() => {
        return isProcessAlive((p: number) => process.kill(p, 0), pid);
      }),
  };
}

// ─── Full Port Adapter Factory ────────────────────────────────────────────────

export function createAgentLifecyclePorts(
  deps: AgentLifecyclePortAdapterDeps
): AgentLifecyclePorts {
  return {
    spawn: createSpawnPort(deps.spawning),
    harness: createHarnessSpawnPort(deps),
    sessionId: deps.sessionId,
    machineId: deps.machineId,
  } as AgentLifecyclePorts;
}
