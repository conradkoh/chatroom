/**
 * UpdateService — Effect-TS service definition for update command operations.
 *
 * Provides version checking and shell execution for the update command.
 * This is a command-scoped service (not used elsewhere in the CLI).
 */

import { Context, Effect, Layer } from 'effect';

export interface ExecResult {
  stdout: string;
  stderr?: string;
}

export interface UpdateServiceShape {
  getVersion: () => Effect.Effect<string>;
  exec: (cmd: string) => Effect.Effect<ExecResult, Error>;
}

export class UpdateService extends Context.Tag('UpdateService')<
  UpdateService,
  UpdateServiceShape
>() {}

/**
 * Live Layer — wraps getVersion and exec functions
 *
 * @param ops - Object with getVersion and exec functions
 * @returns Layer providing UpdateService
 */
export const UpdateServiceLive = (ops: {
  getVersion: () => string;
  exec: (cmd: string) => Promise<ExecResult>;
}): Layer.Layer<UpdateService> =>
  Layer.succeed(UpdateService, {
    getVersion: () => Effect.sync(() => ops.getVersion()),
    exec: (cmd: string) =>
      Effect.tryPromise({
        try: () => ops.exec(cmd),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
  });
