import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatCursorSdkLoadError,
  getBundledCursorSdkVersion,
  importBundledCursorSdk,
} from './cursor-sdk-package.js';

const CLI_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('cursor-sdk-package', () => {
  it('resolves the pinned @cursor/sdk version from the chatroom-cli install', () => {
    expect(getBundledCursorSdkVersion(import.meta.url)).toBe('1.0.18');
  });

  it('imports @cursor/sdk from the chatroom-cli dependency graph', async () => {
    const sdk = await importBundledCursorSdk(import.meta.url);
    expect(sdk.Agent).toBeDefined();
    expect(sdk.Cursor).toBeDefined();
  });

  it('formats chunk load failures with chatroom-cli reinstall guidance', () => {
    const message = formatCursorSdkLoadError(
      new Error(
        "Cannot find module '/path/to/@cursor/sdk/dist/esm/745.index.js' imported from /path/to/index.js"
      )
    );

    expect(message).toContain('745.index.js');
    expect(message).toContain('npm install -g chatroom-cli@latest');
  });

  it('resolveChatroomCliRoot works from the compiled dist layout', () => {
    const distFile = join(CLI_ROOT, 'dist', 'index.js');
    expect(getBundledCursorSdkVersion(pathToFileURL(distFile).href)).toBe('1.0.18');
  });
});
