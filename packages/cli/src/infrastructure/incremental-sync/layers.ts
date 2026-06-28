/**
 * Effect layers for incremental-sync — testable clock injection.
 */

import { Context, Effect, Layer } from 'effect';

export interface PollClockShape {
  readonly sleep: (ms: number) => Effect.Effect<void>;
}

export class PollClock extends Context.Tag('PollClock')<PollClock, PollClockShape>() {}

export const PollClockLive: Layer.Layer<PollClock> = Layer.succeed(PollClock, {
  sleep: (ms) => Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms))),
});
