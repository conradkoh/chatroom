import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatClaudeSdkLoadError,
  getBundledClaudeSdkVersion,
  importBundledClaudeSdk,
  pinNativeBinary,
} from './claude-sdk-package.js';

const CLI_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('pinNativeBinary', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pin-native-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('copies the binary into a version-keyed directory outside the source', () => {
    mkdirSync(join(workDir, 'install'));
    const source = join(workDir, 'install', 'claude');
    writeFileSync(source, 'binary-bytes', { mode: 0o600 });
    const pinRoot = join(workDir, 'pins');

    const pinned = pinNativeBinary(source, '0.3.293', pinRoot);

    expect(pinned).toBe(join(pinRoot, '0.3.293', 'claude'));
    expect(readFileSync(pinned, 'utf8')).toBe('binary-bytes');
    expect(statSync(pinned).mode & 0o777).toBe(0o755);
  });

  it('keeps working after the source install is removed', () => {
    mkdirSync(join(workDir, 'install'));
    const source = join(workDir, 'install', 'claude');
    writeFileSync(source, 'binary-bytes');
    const pinned = pinNativeBinary(source, '0.3.293', join(workDir, 'pins'));

    rmSync(join(workDir, 'install'), { recursive: true, force: true });

    expect(existsSync(pinned)).toBe(true);
    expect(readFileSync(pinned, 'utf8')).toBe('binary-bytes');
  });

  it('reuses an existing pin instead of copying again', () => {
    const source = join(workDir, 'claude');
    writeFileSync(source, 'first');
    const pinRoot = join(workDir, 'pins');
    const pinned = pinNativeBinary(source, '0.3.293', pinRoot);

    writeFileSync(source, 'second');
    expect(pinNativeBinary(source, '0.3.293', pinRoot)).toBe(pinned);
    expect(readFileSync(pinned, 'utf8')).toBe('first');
  });
});

describe('claude-sdk-package', () => {
  it('resolves the pinned @anthropic-ai/claude-agent-sdk version from the chatroom-cli install', () => {
    expect(getBundledClaudeSdkVersion(import.meta.url)).toBe('0.3.293');
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
    expect(getBundledClaudeSdkVersion(pathToFileURL(distFile).href)).toBe('0.3.293');
  });
});
