// fallow-ignore-next-line unused-file
/**
 * ClockService — Effect-TS service definition for time and delays.
 *
 * Wraps ClockOps in an Effect Context.Tag for dependency injection via Layers.
 * Phase 1: Define service interface; existing ClockOps consumers unchanged until Phase 2+.
 */

import { Context, Effect, Layer } from 'effect';

export interface ClockServiceShape {
  /** Get current timestamp in milliseconds */
  now: () => Effect.Effect<number>;
  /** Async delay (wraps setTimeout) */
  delay: (ms: number) => Effect.Effect<void>;
}

export class ClockService extends Context.Tag('ClockService')<ClockService, ClockServiceShape>() {}

/**
 * Live Layer — uses real Date.now() and setTimeout.
 */
export const ClockServiceLive: Layer.Layer<ClockService> = Layer.succeed(ClockService, {
  now: () => Effect.sync(() => Date.now()),
  delay: (ms) => Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms))),
});
