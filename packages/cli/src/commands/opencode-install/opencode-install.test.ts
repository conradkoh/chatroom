/**
 * OpenCode Install Effect Pipeline Tests
 *
 * Tests the pure Effect pipeline (installToolEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing console output behavior directly (which belongs in boundary tests).
 */

import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { installToolEffect, type InstallToolError, type ToolInstallOptions } from './index.js';
import { OpenCodeInstallFsService } from './opencode-install-fs-service.js';

// ---------------------------------------------------------------------------
// Mock modules (for os.homedir and path.join used in installToolEffect)
// ---------------------------------------------------------------------------

vi.mock('os', () => ({
  homedir: () => '/home/user',
}));

vi.mock('path', () => ({
  join: (...parts: string[]) => parts.join('/'),
}));

// ─── Test Helpers ──────────────────────────────────────────────────────────

const TOOL_PATH = '/home/user/.config/opencode/tool/chatroom.ts';
const HANDOFF_PATH = '/home/user/.config/opencode/tool/chatroom-handoff.ts';

function makeTestFsService(config: {
  toolExists?: boolean;
  handoffExists?: boolean;
  chatroomInstalled?: boolean;
  mkdirError?: Error;
  writeFileError?: Error;
}) {
  return Layer.succeed(OpenCodeInstallFsService, {
    access: vi.fn((p: string) => {
      if (p === TOOL_PATH) return Effect.succeed(config.toolExists ?? false);
      if (p === HANDOFF_PATH) return Effect.succeed(config.handoffExists ?? false);
      return Effect.succeed(false);
    }),
    mkdir: vi.fn((_p: string, _opts: { recursive: boolean }) => {
      if (config.mkdirError) return Effect.fail(config.mkdirError);
      return Effect.succeed(undefined);
    }),
    writeFile: vi.fn((_p: string, _content: string, _enc: string) => {
      if (config.writeFileError) return Effect.fail(config.writeFileError);
      return Effect.succeed(undefined);
    }),
    isChatroomInstalled: vi.fn(() => Effect.succeed(config.chatroomInstalled ?? true)),
  });
}

const defaultOptions: ToolInstallOptions = { checkExisting: true };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('installToolEffect', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds when tools do not exist and chatroom is installed', async () => {
    const testLayer = makeTestFsService({
      toolExists: false,
      handoffExists: false,
      chatroomInstalled: true,
    });

    const exit = await Effect.runPromiseExit(
      installToolEffect(defaultOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
    if (exit._tag === 'Success') {
      expect(exit.value.success).toBe(true);
      expect(exit.value.toolPath).toBe(TOOL_PATH);
      expect(exit.value.message).toContain('Installed chatroom OpenCode tools successfully');
    }
  });

  test('fails with ToolsAlreadyExist when chatroom.ts already exists', async () => {
    const testLayer = makeTestFsService({
      toolExists: true,
      handoffExists: false,
      chatroomInstalled: true,
    });

    const exit = await Effect.runPromiseExit(
      installToolEffect(defaultOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as InstallToolError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ToolsAlreadyExist');
      if (error?._tag === 'ToolsAlreadyExist') {
        expect(error.paths).toContain(TOOL_PATH);
      }
    }
  });

  test('fails with ToolsAlreadyExist when both tool files already exist', async () => {
    const testLayer = makeTestFsService({
      toolExists: true,
      handoffExists: true,
      chatroomInstalled: true,
    });

    const exit = await Effect.runPromiseExit(
      installToolEffect(defaultOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as InstallToolError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ToolsAlreadyExist');
      if (error?._tag === 'ToolsAlreadyExist') {
        expect(error.paths).toHaveLength(2);
      }
    }
  });

  test('fails with ChatroomNotInstalled when chatroom CLI is not found', async () => {
    const testLayer = makeTestFsService({
      toolExists: false,
      handoffExists: false,
      chatroomInstalled: false,
    });

    const exit = await Effect.runPromiseExit(
      installToolEffect(defaultOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as InstallToolError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ChatroomNotInstalled');
    }
  });

  test('fails with FsError when writeFile throws', async () => {
    const testLayer = makeTestFsService({
      toolExists: false,
      handoffExists: false,
      chatroomInstalled: true,
      writeFileError: new Error('Permission denied'),
    });

    const exit = await Effect.runPromiseExit(
      installToolEffect(defaultOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as InstallToolError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('FsError');
      if (error?._tag === 'FsError') {
        expect(error.cause.message).toBe('Permission denied');
      }
    }
  });

  test('skips existence check when checkExisting is false', async () => {
    // Even with tools "existing", should proceed when checkExisting is false
    const testLayer = makeTestFsService({
      toolExists: true,
      handoffExists: true,
      chatroomInstalled: true,
    });

    const exit = await Effect.runPromiseExit(
      installToolEffect({ checkExisting: false }).pipe(Effect.provide(testLayer))
    );

    // Should succeed (existence check skipped)
    expect(exit._tag).toBe('Success');
    if (exit._tag === 'Success') {
      expect(exit.value.success).toBe(true);
    }
  });
});
