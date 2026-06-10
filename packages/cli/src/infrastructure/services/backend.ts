// fallow-ignore-next-line unused-file
/**
 * BackendService — Effect-TS service definition for Convex backend operations.
 *
 * Wraps BackendOps in an Effect Context.Tag for dependency injection via Layers.
 * Phase 1: Define service interface; existing BackendOps consumers unchanged until Phase 2+.
 */

import type { FunctionReference } from 'convex/server';
import { Context, Effect, Layer } from 'effect';

export interface BackendServiceShape {
  mutation: <T>(
    endpoint: FunctionReference<'mutation'>,
    args: Record<string, unknown>
  ) => Effect.Effect<T, Error>;
  query: <T>(
    endpoint: FunctionReference<'query'>,
    args: Record<string, unknown>
  ) => Effect.Effect<T, Error>;
  action: <T>(
    endpoint: FunctionReference<'action'>,
    args: Record<string, unknown>
  ) => Effect.Effect<T, Error>;
}

export class BackendService extends Context.Tag('BackendService')<
  BackendService,
  BackendServiceShape
>() {}

/**
 * Live Layer — wraps a ConvexClient (or BackendOps-compatible object).
 *
 * @param ops - Object with mutation and query methods returning Promises
 * @returns Layer providing BackendService
 */
export const BackendServiceLive = (ops: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (e: any, a: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (e: any, a: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action?: (e: any, a: any) => Promise<any>;
}): Layer.Layer<BackendService> =>
  Layer.succeed(BackendService, {
    mutation: (endpoint, args) =>
      Effect.tryPromise({
        try: () => ops.mutation(endpoint, args),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    query: (endpoint, args) =>
      Effect.tryPromise({
        try: () => ops.query(endpoint, args),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    action: (endpoint, args) =>
      Effect.tryPromise({
        try: () =>
          ops.action
            ? ops.action(endpoint, args)
            : Promise.reject(new Error('Action not supported')),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
  });
