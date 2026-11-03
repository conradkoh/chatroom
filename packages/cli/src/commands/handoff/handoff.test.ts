/**
 * Handoff Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (handoffEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { FileAttachmentUploaderOps, HandoffGatewayOps, HandoffResult } from './deps.js';
import { handoffEffect, type HandoffError, type HandoffOptions } from './index.js';
import {
  BackendService,
  CliGatewayServiceLive,
  SessionService,
} from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with configurable query/mutation responses */
function makeTestBackend(config: {
  queryResponse?: unknown | Error | undefined;
  mutationResponse?: unknown | Error | undefined;
  queryResponses?: (unknown | Error)[] | undefined;
}) {
  let queryCallCount = 0;
  const mutation = vi.fn((_endpoint: any, _args: unknown) => {
    if (config.mutationResponse instanceof Error) {
      return Effect.fail(config.mutationResponse) as any;
    }
    return Effect.succeed(config.mutationResponse) as any;
  });
  return Layer.mergeAll(
    Layer.succeed(BackendService, {
      query: vi.fn((_endpoint: any, _args: unknown) => {
        if (config.queryResponses) {
          const response = config.queryResponses[queryCallCount] ?? null;
          queryCallCount++;
          if (response instanceof Error) {
            return Effect.fail(response) as any;
          }
          return Effect.succeed(response) as any;
        }
        if (config.queryResponse instanceof Error) {
          return Effect.fail(config.queryResponse) as any;
        }
        return Effect.succeed(config.queryResponse) as any;
      }),
      mutation,
      action: vi.fn(() => Effect.fail(new Error('Action not used in handoff')) as any),
    }),
    CliGatewayServiceLive({
      handoff: async () => {
        if (config.mutationResponse instanceof Error) throw config.mutationResponse;
        return config.mutationResponse as HandoffResult;
      },
    })
  );
}

/** Create a test session service with configurable responses */
function makeTestSession(config: {
  sessionId?: string | null | undefined;
  convexUrl?: string | undefined;
  otherUrls?: string[] | undefined;
}) {
  return Layer.succeed(SessionService, {
    getSessionId: () =>
      Effect.succeed(
        (config.sessionId !== undefined
          ? config.sessionId
          : 'test-session-id') as unknown as SessionId
      ),
    getConvexUrl: () => Effect.succeed(config.convexUrl ?? 'https://test.convex.cloud'),
    getOtherSessionUrls: () => Effect.succeed(config.otherUrls ?? []),
  });
}

/** Layer for attachment tests: captures the gateway call and ignores the backend. */
function makeAttachmentLayer(gateway: HandoffGatewayOps) {
  return Layer.mergeAll(
    Layer.succeed(BackendService, {
      query: vi.fn(() => Effect.succeed(null) as any),
      mutation: vi.fn(() => Effect.succeed(null) as any),
      action: vi.fn(() => Effect.succeed(null) as any),
    }),
    CliGatewayServiceLive(gateway),
    makeTestSession({ sessionId: 'test-session' })
  );
}

function createFakeUploader(overrides: Partial<FileAttachmentUploaderOps> = {}) {
  const beginUpload = vi.fn(async ({ filename }: { filename: string }) => ({
    attachmentId: `id-${filename}`,
    uploadUrl: `https://test.site/upload/${filename}`,
  }));
  const uploadBytes = vi.fn(async () => {});
  const discardUploads = vi.fn(async () => {});
  const uploader: FileAttachmentUploaderOps = {
    beginUpload,
    uploadBytes,
    discardUploads,
    ...overrides,
  };
  return { uploader, beginUpload, uploadBytes, discardUploads };
}

async function withTempAttachments<T>(run: (paths: string[]) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'chatroom-handoff-attachments-'));
  try {
    const paths = [join(directory, 'a.png'), join(directory, 'b.pdf')];
    await writeFile(paths[0]!, 'a');
    await writeFile(paths[1]!, 'b');
    return await run(paths);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handoffEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions: HandoffOptions = {
    role: 'planner',
    message: 'Handoff message',
    nextRole: 'builder',
  };

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({
        sessionId: null,
        convexUrl: 'https://test.convex.cloud',
        otherUrls: ['https://prod.convex.cloud'],
      })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.findErrorOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
      if (error?._tag === 'NotAuthenticated') {
        expect(error.convexUrl).toBe('https://test.convex.cloud');
        expect(error.otherUrls).toEqual(['https://prod.convex.cloud']);
      }
    }
  });

  test('fails with InvalidChatroomId when ID is too short', async () => {
    const shortId = 'short123'; // Less than 20 chars
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.findErrorOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with InvalidChatroomId when ID is too long', async () => {
    const longId = 'a'.repeat(50); // More than 40 chars
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(longId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.findErrorOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
    }
  });

  test('fails with HandoffFailed when handoff mutation throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: new Error('Handoff mutation failed') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.findErrorOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('HandoffFailed');
      if (error?._tag === 'HandoffFailed') {
        expect(error.cause.message).toBe('Handoff mutation failed');
      }
    }
  });

  test('fails with HandoffRejected when handoff returns success=false', async () => {
    const rejectionError = {
      message: 'Invalid target role',
      code: 'INVALID_TARGET_ROLE',
      suggestedTargets: ['planner', 'architect'],
    };
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        mutationResponse: {
          success: false,
          error: rejectionError,
        },
      }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.findErrorOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('HandoffRejected');
      if (error?._tag === 'HandoffRejected') {
        expect(error.error.message).toBe('Invalid target role');
        expect(error.error.code).toBe('INVALID_TARGET_ROLE');
        expect(error.error.suggestedTargets).toEqual(['planner', 'architect']);
      }
    }
  });

  test('succeeds when handoff mutation returns success=true', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        mutationResponse: { success: true },
      }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('passes attached file ids to the gateway in upload order', async () => {
    const gateway = vi.fn(async (_args: Parameters<HandoffGatewayOps['handoff']>[0]) => ({
      success: true,
    }));
    const { uploader, beginUpload, uploadBytes } = createFakeUploader();
    const testLayer = makeAttachmentLayer({ handoff: gateway });

    await withTempAttachments(async (paths) => {
      const exit = await Effect.runPromiseExit(
        handoffEffect(
          validChatroomId,
          { ...validOptions, nextRole: 'user', attachFiles: paths },
          uploader
        ).pipe(Effect.provide(testLayer))
      );

      expect(exit._tag).toBe('Success');
    });

    expect(beginUpload.mock.calls.map(([args]) => args.filename)).toEqual(['a.png', 'b.pdf']);
    expect(uploadBytes).toHaveBeenCalledTimes(2);
    expect(gateway).toHaveBeenCalledWith(
      expect.objectContaining({ attachedFileIds: ['id-a.png', 'id-b.pdf'] })
    );
  });

  test('discards uploaded ids when the handoff is rejected', async () => {
    const gateway = vi.fn(async () => ({
      success: false,
      error: { message: 'rejected', code: 'FILE_ATTACHMENT_INVALID' },
    }));
    const { uploader, discardUploads } = createFakeUploader();
    const testLayer = makeAttachmentLayer({ handoff: gateway });

    await withTempAttachments(async (paths) => {
      const exit = await Effect.runPromiseExit(
        handoffEffect(
          validChatroomId,
          { ...validOptions, nextRole: 'user', attachFiles: paths },
          uploader
        ).pipe(Effect.provide(testLayer))
      );

      expect(exit._tag).toBe('Failure');
      if (exit._tag === 'Failure') {
        const error = Cause.findErrorOption(exit.cause).pipe((option) =>
          option._tag === 'Some' ? option.value : null
        ) as HandoffError | null;
        expect(error?._tag).toBe('HandoffRejected');
      }
    });

    expect(discardUploads).toHaveBeenCalledWith({
      sessionId: 'test-session',
      attachmentIds: ['id-a.png', 'id-b.pdf'],
    });
  });

  test('does not touch the uploader when there are no attachments', async () => {
    const gateway = vi.fn(async (_args: Parameters<HandoffGatewayOps['handoff']>[0]) => ({
      success: true,
    }));
    const { uploader, beginUpload, uploadBytes, discardUploads } = createFakeUploader();
    const testLayer = makeAttachmentLayer({ handoff: gateway });

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions, uploader).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
    expect(beginUpload).not.toHaveBeenCalled();
    expect(uploadBytes).not.toHaveBeenCalled();
    expect(discardUploads).not.toHaveBeenCalled();
    expect(gateway.mock.calls[0]?.[0]).not.toHaveProperty('attachedFileIds');
  });
});
