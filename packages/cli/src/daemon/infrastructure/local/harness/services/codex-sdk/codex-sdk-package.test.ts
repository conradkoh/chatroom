import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatCodexSdkError,
  formatCodexSdkLoadError,
  getBundledCodexSdkVersion,
  importBundledCodexSdk,
} from './codex-sdk-package.js';

const CLI_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('codex-sdk-package', () => {
  it('resolves the pinned @openai/codex-sdk version from the chatroom-cli install', () => {
    expect(getBundledCodexSdkVersion(import.meta.url)).toBe('0.147.0');
  });

  it('imports @openai/codex-sdk from the chatroom-cli dependency graph', async () => {
    const sdk = await importBundledCodexSdk(import.meta.url);
    expect(sdk.Codex).toBeDefined();
    expect(typeof sdk.Codex).toBe('function');
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
});
