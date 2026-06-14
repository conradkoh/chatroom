/**
 * AgentLifecycleRuntime — bridges Effect Layer to imperative APM.
 *
 * Creates a ManagedRuntime from AgentLifecycleServiceLive with the
 * port adapter configured via createAgentLifecyclePorts.
 */

import type { Effect } from 'effect';
import { Layer, ManagedRuntime } from 'effect';

import {
  createAgentLifecyclePorts,
  type AgentLifecyclePortAdapterDeps,
} from './agent-lifecycle-port-adapters.js';
import { AgentLifecycleServiceLive } from './agent-lifecycle-service.js';
import type { AgentLifecycleService } from './agent-lifecycle-types.js';
import { AgentLifecyclePorts } from './agent-lifecycle-types.js';

export function createAgentLifecycleRuntime(deps: AgentLifecyclePortAdapterDeps) {
  const layer = Layer.provide(
    AgentLifecycleServiceLive,
    Layer.succeed(AgentLifecyclePorts, createAgentLifecyclePorts(deps))
  );
  const runtime = ManagedRuntime.make(layer);
  return {
    runtime,
    runPromise<A>(effect: Effect.Effect<A, unknown, AgentLifecycleService>) {
      return runtime.runPromise(effect);
    },
    dispose: () => runtime.dispose(),
  };
}

export type AgentLifecycleRuntime = ReturnType<typeof createAgentLifecycleRuntime>;
