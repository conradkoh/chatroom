import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatCodexSdkError,
  formatCodexSdkLoadError,
  getBundledCodexSdkVersion,
  importBundledCodexSdk,
  resetCodexExecutablePathCacheForTests,
  resolveCodexExecutablePath,
} from './codex-sdk-package.js';

const CLI_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

afterEach(() => {
  resetCodexExecutablePathCacheForTests();
});

describe('codex-sdk-package', () => {
  it('resolves the pinned @openai/codex-sdk version from the chatroom-cli install', () => {
    expect(getBundledCodexSdkVersion(import.meta.url)).toBe('0.147.0');
  });

  it('imports @openai/codex-sdk from the chatroom-cli dependency graph', async () => {
    const sdk = await importBundledCodexSdk(import.meta.url);
    expect(sdk.Codex).toBeDefined();
    expect(typeof sdk.Codex).toBe('function');
  });

  it('resolves the Codex CLI binary from the chatroom-cli install root', () => {
    const binaryPath = resolveCodexExecutablePath(import.meta.url);
    expect(binaryPath).toContain('codex');
    expect(existsSync(binaryPath)).toBe(true);
  });

  it('resolveChatroomCliRoot works from the compiled dist layout', () => {
    const distFile = join(CLI_ROOT, 'dist', 'index.js');
    expect(getBundledCodexSdkVersion(pathToFileURL(distFile).href)).toBe('0.147.0');
  });

  it('formats SDK runtime errors with code and name', () => {
    const message = formatCodexSdkError(
      Object.assign(new Error('codex login required'), {
        name: 'AuthError',
        code: 'CODEX_AUTH',
      })
    );

    expect(message).toBe('AuthError: [CODEX_AUTH] codex login required');
  });

  it('formats load errors with chatroom-cli reinstall guidance', () => {
    const message = formatCodexSdkLoadError(new Error('Cannot find package @openai/codex-sdk'));

    expect(message).toContain('Cannot find package @openai/codex-sdk');
  });

  it('formats missing platform package errors with reinstall guidance', () => {
    const message = formatCodexSdkLoadError(
      new Error(
        'Unable to locate Codex CLI binaries for aarch64-apple-darwin. Ensure @openai/codex is installed with optional dependencies.'
      )
    );

    expect(message).toContain('npm install -g chatroom-cli@latest');
  });
});
