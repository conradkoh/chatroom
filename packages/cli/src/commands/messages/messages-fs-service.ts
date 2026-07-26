import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';

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

export function buildMessageMarkdown(msg: {
  _id: string;
  _creationTime: number;
  senderRole: string;
  type: string;
  content: string;
  targetRole?: string | null;
  classification?: string | null;
  taskStatus?: string | null;
  featureTitle?: string | null;
}): string {
  const ts = new Date(msg._creationTime).toISOString();
  const parts: string[] = [];
  parts.push('---');
  parts.push(`id: ${msg._id}`);
  parts.push(`createdAt: ${ts}`);
  parts.push(`senderRole: ${msg.senderRole}`);
  parts.push(`type: ${msg.type}`);
  if (msg.targetRole) parts.push(`targetRole: ${msg.targetRole}`);
  if (msg.classification) parts.push(`classification: ${msg.classification}`);
  if (msg.taskStatus) parts.push(`taskStatus: ${msg.taskStatus}`);
  if (msg.featureTitle) parts.push(`featureTitle: ${msg.featureTitle}`);
  parts.push('---');
  parts.push('');
  parts.push(msg.content);
  return parts.join('\n');
}

export function buildTranscriptMarkdown(
  messages: Array<{ _creationTime: number; senderRole: string; content: string; _id: string }>
): string {
  return messages
    .map((msg) => {
      const ts = new Date(msg._creationTime).toISOString();
      return `## ${ts} | ${msg.senderRole} | ${msg._id}\n\n${msg.content}`;
    })
    .join('\n\n---\n\n');
}

export function messageFilename(msg: { _id: string; _creationTime: number }): string {
  const ts = new Date(msg._creationTime).toISOString().replace(/[:.]/g, '-');
  return `${ts}_${msg._id}.md`;
}
