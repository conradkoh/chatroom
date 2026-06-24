import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatPiSdkLoadError,
  getBundledPiSdkVersion,
  importBundledPiSdk,
} from './pi-sdk-package.js';

const CLI_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('pi-sdk-package', () => {
  it('resolves the pinned @earendil-works/pi-coding-agent version from the chatroom-cli install', () => {
    expect(getBundledPiSdkVersion(import.meta.url)).toBe('0.74.2');
  });

  it('imports @earendil-works/pi-coding-agent from the chatroom-cli dependency graph', async () => {
    const sdk = await importBundledPiSdk(import.meta.url);
    expect(sdk.createAgentSession).toBeTypeOf('function');
    expect(sdk.AuthStorage).toBeDefined();
    expect(sdk.ModelRegistry).toBeDefined();
  });

  it('formats load failures with chatroom-cli reinstall guidance', () => {
    const message = formatPiSdkLoadError(
      new Error('No "exports" main defined in /path/to/pi-coding-agent/package.json')
    );

    expect(message).toContain('exports');
  });

  it('resolveChatroomCliRoot works from the compiled dist layout', () => {
    const distFile = join(CLI_ROOT, 'dist', 'index.js');
    expect(getBundledPiSdkVersion(pathToFileURL(distFile).href)).toBe('0.74.2');
  });
});
