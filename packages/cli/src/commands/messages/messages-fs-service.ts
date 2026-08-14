import * as nodeFs from 'node:fs/promises';

import { Context, Effect, Layer } from 'effect';

export interface MessagesFsServiceShape {
  writeFile: (path: string, data: string) => Effect.Effect<void, Error>;
  mkdir: (
    path: string,
    options?: { recursive?: boolean }
  ) => Effect.Effect<string | undefined, Error>;
  rm: (
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ) => Effect.Effect<void, Error>;
}

export class MessagesFsService extends Context.Tag('MessagesFsService')<
  MessagesFsService,
  MessagesFsServiceShape
>() {}

export const MessagesFsServiceLive: Layer.Layer<MessagesFsService> = Layer.succeed(
  MessagesFsService,
  {
    writeFile: (path, data) =>
      Effect.tryPromise({
        try: () => nodeFs.writeFile(path, data, 'utf-8'),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    mkdir: (path, opts) =>
      Effect.tryPromise({
        try: () => nodeFs.mkdir(path, opts) as Promise<string | undefined>,
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    rm: (path, opts) =>
      Effect.tryPromise({
        try: () => nodeFs.rm(path, opts) as Promise<void>,
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
  }
);

const SORT_KEY_MAX = 9_999_999_999_999;

export function messageFilename(msg: {
  _id: string;
  _creationTime: number;
  senderRole: string;
  targetRole?: string | null;
}): string {
  const sortPrefix = String(SORT_KEY_MAX - msg._creationTime).padStart(13, '0');
  const receiver = msg.targetRole ?? 'all';
  return `${sortPrefix}_${msg.senderRole}-to-${receiver}_${msg._id}.md`;
}
