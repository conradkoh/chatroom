import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatClaudeSdkLoadError,
  getBundledClaudeSdkVersion,
  importBundledClaudeSdk,
} from './claude-sdk-package.js';

const CLI_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('claude-sdk-package', () => {
  it('resolves the pinned @anthropic-ai/claude-agent-sdk version from the chatroom-cli install', () => {
    expect(getBundledClaudeSdkVersion(import.meta.url)).toBe('0.3.208');
  });

  it('imports @anthropic-ai/claude-agent-sdk from the chatroom-cli dependency graph', async () => {
    const sdk = await importBundledClaudeSdk(import.meta.url);
    expect(sdk.query).toBeTypeOf('function');
  }, 15_000);

  it('formats load failures with chatroom-cli reinstall guidance', () => {
    const message = formatClaudeSdkLoadError(
      new Error('Native CLI binary for darwin-arm64 not found')
    );
    expect(message).toContain('Reinstall chatroom-cli');
  });

  it('resolveChatroomCliRoot works from the compiled dist layout', () => {
    const distFile = join(CLI_ROOT, 'dist', 'index.js');
    expect(getBundledClaudeSdkVersion(pathToFileURL(distFile).href)).toBe('0.3.208');
  });
});
