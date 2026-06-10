// fallow-ignore-next-line unused-file
/**
 * ProcessService — Effect-TS service definition for OS process management.
 *
 * Wraps ProcessOps in an Effect Context.Tag for dependency injection via Layers.
 * Phase 1: Define service interface; existing ProcessOps consumers unchanged until Phase 2+.
 */

import { Context, Effect, Layer } from 'effect';

import type { Signals } from '../types/signals.js';

export interface ProcessServiceShape {
  /** Send a signal to a process (wraps process.kill) */
  kill: (pid: number, signal?: Signals | number) => Effect.Effect<void, Error>;
  /** Returns true if the process identified by `pid` is still alive */
  isAlive: (pid: number) => Effect.Effect<boolean>;
}

export class ProcessService extends Context.Tag('ProcessService')<
  ProcessService,
  ProcessServiceShape
>() {}

/**
 * Live Layer — uses real process.kill.
 */
export const ProcessServiceLive: Layer.Layer<ProcessService> = Layer.succeed(ProcessService, {
  kill: (pid, signal) =>
    Effect.try({
      try: () => {
        process.kill(pid, signal);
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
  isAlive: (pid) =>
    Effect.sync(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }),
});
