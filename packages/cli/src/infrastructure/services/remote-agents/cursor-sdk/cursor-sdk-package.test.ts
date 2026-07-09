import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatCursorSdkError,
  formatCursorSdkLoadError,
  getBundledCursorSdkVersion,
  importBundledCursorSdk,
} from './cursor-sdk-package.js';

const CLI_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('cursor-sdk-package', () => {
  it('resolves the pinned @cursor/sdk version from the chatroom-cli install', () => {
    expect(getBundledCursorSdkVersion(import.meta.url)).toBe('1.0.23');
  });

  it('imports @cursor/sdk from the chatroom-cli dependency graph', async () => {
    const sdk = await importBundledCursorSdk(import.meta.url);
    expect(sdk.Agent).toBeDefined();
    expect(sdk.Cursor).toBeDefined();
  });

  it('loads named exports when resolved through the CJS entry path (Node global installs)', async () => {
    const sdkRoot = join(CLI_ROOT, 'node_modules', '@cursor', 'sdk');
    const cjsEntry = join(sdkRoot, 'dist', 'cjs', 'index.js');
    const esmEntry = join(sdkRoot, 'dist', 'esm', 'index.js');
    expect(cjsEntry).toBeTruthy();
    expect(esmEntry).toBeTruthy();

    const { createRequire } = await import('node:module');
    const require = createRequire(join(CLI_ROOT, 'package.json'));
    const resolvedCjs = require.resolve('@cursor/sdk', { paths: [CLI_ROOT] });
    expect(resolvedCjs.endsWith('dist/cjs/index.js')).toBe(true);

    const sdk = await importBundledCursorSdk(import.meta.url);
    const { Agent, Cursor } = sdk;
    expect(typeof Agent).toBe('function');
    expect(Cursor).toBeDefined();
  });

  it('formats SDK runtime errors with code and name', () => {
    const message = formatCursorSdkError(
      Object.assign(new Error('sandbox not supported: bubblewrap missing'), {
        name: 'ConfigurationError',
        code: 'SANDBOX_UNSUPPORTED',
      })
    );

    expect(message).toBe(
      'ConfigurationError: [SANDBOX_UNSUPPORTED] sandbox not supported: bubblewrap missing'
    );
  });

  it('formats chunk load failures with chatroom-cli reinstall guidance', () => {
    const message = formatCursorSdkLoadError(
      new Error(
        "Cannot find module '/path/to/@cursor/sdk/dist/esm/988.index.js' imported from /path/to/index.js"
      )
    );

    expect(message).toContain('988.index.js');
    expect(message).toContain('npm install -g chatroom-cli@latest');
  });

  it('resolveChatroomCliRoot works from the compiled dist layout', () => {
    const distFile = join(CLI_ROOT, 'dist', 'index.js');
    expect(getBundledCursorSdkVersion(pathToFileURL(distFile).href)).toBe('1.0.23');
  });
});
