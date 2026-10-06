/**
 * BackendService Tests — TDD unit tests for Effect-TS service layer.
 *
 * Tests use in-memory test layers to verify Effect pipeline behavior without touching a real backend.
 */

import { ConvexError } from 'convex/values';
import { Effect } from 'effect';
import { describe, it, expect } from 'vitest';

import { BackendService, BackendServiceLive } from './backend.js';
import { api } from '../../api.js';
import { getErrorMessage } from '../../utils/convex-error.js';

describe('BackendService', () => {
  it('mutation returns the resolved value', async () => {
    const layer = BackendService.of({
      mutation: () => Effect.succeed('ok') as any,
      query: () => Effect.die('not called') as any,
      action: () => Effect.die('not called') as any,
    });
    const result = await Effect.runPromise(
      BackendService.pipe(
        Effect.flatMap((svc) => svc.mutation({} as any, {})),
        Effect.provideService(BackendService, layer)
      )
    );
    expect(result).toBe('ok');
  });

  it('query returns the resolved value', async () => {
    const layer = BackendService.of({
      mutation: () => Effect.die('not called') as any,
      query: () => Effect.succeed({ data: 'test' }) as any,
      action: () => Effect.die('not called') as any,
    });
    const result = await Effect.runPromise(
      BackendService.pipe(
        Effect.flatMap((svc) => svc.query({} as any, {})),
        Effect.provideService(BackendService, layer)
      )
    );
    expect(result).toEqual({ data: 'test' });
  });

  it('mutation propagates errors as Effect failures', async () => {
    const testError = new Error('mutation failed');
    const layer = BackendService.of({
      mutation: () => Effect.fail(testError) as any,
      query: () => Effect.die('not called') as any,
      action: () => Effect.die('not called') as any,
    });
    const program = BackendService.pipe(
      Effect.flatMap((svc) => svc.mutation({} as any, {})),
      Effect.provideService(BackendService, layer)
    );
    await expect(Effect.runPromise(program)).rejects.toThrow('mutation failed');
  });

  it('query propagates errors as Effect failures', async () => {
    const testError = new Error('query failed');
    const layer = BackendService.of({
      mutation: () => Effect.die('not called') as any,
      query: () => Effect.fail(testError) as any,
      action: () => Effect.die('not called') as any,
    });
    const program = BackendService.pipe(
      Effect.flatMap((svc) => svc.query({} as any, {})),
      Effect.provideService(BackendService, layer)
    );
    await expect(Effect.runPromise(program)).rejects.toThrow('query failed');
  });

  it('runPromise rejects with the original ConvexError and preserves its message', async () => {
    const error = new ConvexError({ code: 'EXPECTED', message: 'original backend error' });
    const program = Effect.gen(function* () {
      const service = yield* BackendService;
      return yield* service.mutation(api.machines.daemonHeartbeat, {
        sessionId: 'session-test',
        machineId: 'machine-test',
      });
    });
    const live = BackendServiceLive({
      mutation: async () => Promise.reject(error),
      query: async () => undefined,
    });

    await expect(Effect.runPromise(program.pipe(Effect.provide(live)))).rejects.toBe(error);
    expect(getErrorMessage(error)).toBe('original backend error');
  });
});
