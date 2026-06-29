/**
 * Effect layers for incremental-sync — testable clock injection.
 */

import { Context, Effect, Layer } from 'effect';

export interface IntervalClockShape {
  readonly sleep: (ms: number) => Effect.Effect<void>;
}

export class IntervalClock extends Context.Tag('IntervalClock')<
  IntervalClock,
  IntervalClockShape
>() {}

export const IntervalClockLive: Layer.Layer<IntervalClock> = Layer.succeed(IntervalClock, {
  sleep: (ms) => Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms))),
});
