/**
 * Update Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (updateEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { updateEffect, type UpdateError } from './index.js';
import { UpdateService } from './update-service.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test update service with configurable responses */
function makeTestUpdateService(config: {
  version?: string;
  npmVersionResponse?: { stdout: string } | Error;
  latestVersionResponse?: { stdout: string } | Error;
  installResponse?: { stdout: string } | Error;
}) {
  return Layer.succeed(UpdateService, {
    getVersion: () => Effect.succeed(config.version ?? '1.0.0'),
    exec: vi.fn((cmd: string) => {
      if (cmd === 'npm --version') {
        if (config.npmVersionResponse instanceof Error) {
          return Effect.fail(config.npmVersionResponse);
        }
        return Effect.succeed(config.npmVersionResponse ?? { stdout: '10.0.0' });
      }
      if (cmd === 'npm view chatroom-cli version') {
        if (config.latestVersionResponse instanceof Error) {
          return Effect.fail(config.latestVersionResponse);
        }
        return Effect.succeed(config.latestVersionResponse ?? { stdout: '1.1.0' });
      }
      if (cmd === 'npm install -g chatroom-cli@latest') {
        if (config.installResponse instanceof Error) {
          return Effect.fail(config.installResponse);
        }
        return Effect.succeed(config.installResponse ?? { stdout: 'installed successfully' });
      }
      return Effect.fail(new Error(`Unexpected command: ${cmd}`));
    }),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('updateEffect', () => {
  // Mock console.log to avoid test output pollution
  const originalLog = console.log;
  beforeEach(() => {
    console.log = vi.fn();
  });
  afterEach(() => {
    console.log = originalLog;
  });

  test('succeeds when update is available', async () => {
    const testLayer = makeTestUpdateService({
      version: '1.0.0',
      npmVersionResponse: { stdout: '10.0.0' },
      latestVersionResponse: { stdout: '1.1.0' },
      installResponse: { stdout: 'installed' },
    });

    const exit = await Effect.runPromiseExit(updateEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1.0.0 → 1.1.0'));
  });

  test('succeeds with no update when already latest', async () => {
    const testLayer = makeTestUpdateService({
      version: '1.1.0',
      npmVersionResponse: { stdout: '10.0.0' },
      latestVersionResponse: { stdout: '1.1.0' },
    });

    const exit = await Effect.runPromiseExit(updateEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('You already have the latest version!')
    );
  });

  test('fails with NpmNotAvailable when npm is not installed', async () => {
    const testLayer = makeTestUpdateService({
      npmVersionResponse: new Error('npm not found'),
    });

    const exit = await Effect.runPromiseExit(updateEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as UpdateError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NpmNotAvailable');
    }
  });

  test('fails with VersionCheckFailed when cannot fetch latest version', async () => {
    const testLayer = makeTestUpdateService({
      npmVersionResponse: { stdout: '10.0.0' },
      latestVersionResponse: new Error('Network error'),
    });

    const exit = await Effect.runPromiseExit(updateEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as UpdateError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('VersionCheckFailed');
    }
  });

  test('fails with UpdateFailed when install fails', async () => {
    const testLayer = makeTestUpdateService({
      version: '1.0.0',
      npmVersionResponse: { stdout: '10.0.0' },
      latestVersionResponse: { stdout: '1.1.0' },
      installResponse: new Error('Permission denied'),
    });

    const exit = await Effect.runPromiseExit(updateEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as UpdateError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('UpdateFailed');
      if (error?._tag === 'UpdateFailed') {
        expect(error.cause.message).toBe('Permission denied');
      }
    }
  });
});
