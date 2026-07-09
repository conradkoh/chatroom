import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as CursorSdkModule from '@cursor/sdk';

type LoadedCursorSdk = typeof CursorSdkModule;

const REINSTALL_HINT = 'Reinstall chatroom-cli: npm install -g chatroom-cli@latest';

class CursorSdkPackageError extends Error {
  readonly code = 'CURSOR_SDK_PACKAGE_INCOMPLETE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CursorSdkPackageError';
  }
}

// fallow-ignore-next-line complexity
function resolveChatroomCliRoot(moduleRef: string = import.meta.url): string {
  const filePath = moduleRef.startsWith('file:') ? fileURLToPath(moduleRef) : moduleRef;
  let dir = dirname(filePath);

  while (dir !== dirname(dir)) {
    const packageJsonPath = join(dir, 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
      if (pkg.name === 'chatroom-cli') {
        return dir;
      }
    }
    dir = dirname(dir);
  }

  throw new CursorSdkPackageError(
    `Could not locate chatroom-cli package root while resolving @cursor/sdk. ${REINSTALL_HINT}`
  );
}

// fallow-ignore-next-line complexity
function readPinnedSdkVersion(chatroomCliRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(chatroomCliRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const specifier = pkg.dependencies?.['@cursor/sdk'];
  const pinned = specifier?.replace(/^[\^~>=<]+/, '').trim() ?? '';
  const match = pinned.match(/^(\d+\.\d+\.\d+)/);

  if (!match) {
    throw new CursorSdkPackageError(
      `chatroom-cli must pin an exact @cursor/sdk version (found "${specifier ?? 'none'}"). ${REINSTALL_HINT}`
    );
  }

  return match[1];
}

function readInstalledSdkVersion(entryPath: string): string {
  const packageJsonPath = join(dirname(entryPath), '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
  return pkg.version;
}

function resolveSdkEsmImportPath(cjsEntryPath: string): string {
  // require.resolve returns the CJS entry; Node dynamic import() then exposes
  // exports on `default` instead of named bindings. Prefer the ESM entry so
  // `const { Agent } = await loadSdk()` works under Node like a bare import().
  const importPath = cjsEntryPath.includes('/dist/cjs/')
    ? cjsEntryPath.replace('/dist/cjs/', '/dist/esm/')
    : cjsEntryPath;
  if (!existsSync(importPath)) {
    throw new CursorSdkPackageError(
      `@cursor/sdk ESM entry file is missing: ${importPath}. ${REINSTALL_HINT}`
    );
  }
  return importPath;
}

/**
 * Resolve and import @cursor/sdk from this chatroom-cli install.
 *
 * Uses require.resolve(..., { paths: [chatroomCliRoot] }) so npm global installs
 * use the copy installed with chatroom-cli, not a separately hoisted global package.
 */
// fallow-ignore-next-line complexity
export async function importBundledCursorSdk(
  moduleRef: string = import.meta.url
): Promise<LoadedCursorSdk> {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const require = createRequire(join(chatroomCliRoot, 'package.json'));
  const pinnedVersion = readPinnedSdkVersion(chatroomCliRoot);
  const entryPath = require.resolve('@cursor/sdk', { paths: [chatroomCliRoot] });
  const installedVersion = readInstalledSdkVersion(entryPath);

  if (installedVersion !== pinnedVersion) {
    throw new CursorSdkPackageError(
      `@cursor/sdk@${installedVersion} does not match chatroom-cli pin (${pinnedVersion}). ${REINSTALL_HINT}`
    );
  }

  if (!existsSync(entryPath)) {
    throw new CursorSdkPackageError(
      `@cursor/sdk entry file is missing: ${entryPath}. ${REINSTALL_HINT}`
    );
  }

  const sdk = await import(pathToFileURL(resolveSdkEsmImportPath(entryPath)).href);
  sdk.configureCursorSdk({ local: { useHttp1ForAgent: true } });
  return sdk;
}

export function getBundledCursorSdkVersion(moduleRef: string = import.meta.url): string {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const require = createRequire(join(chatroomCliRoot, 'package.json'));
  const entryPath = require.resolve('@cursor/sdk', { paths: [chatroomCliRoot] });
  return readInstalledSdkVersion(entryPath);
}

// fallow-ignore-next-line complexity
export function formatCursorSdkError(err: unknown): string {
  if (err instanceof Error) {
    const sdkErr = err as Error & { code?: string; name?: string };
    const code = sdkErr.code ? `[${sdkErr.code}] ` : '';
    const name = sdkErr.name && sdkErr.name !== 'Error' ? `${sdkErr.name}: ` : '';
    return `${name}${code}${err.message}`.trim();
  }
  return String(err);
}

export function formatCursorSdkLoadError(err: unknown): string {
  if (err instanceof CursorSdkPackageError) {
    return err.message;
  }

  const message = formatCursorSdkError(err);
  const chunkMatch = message.match(/(\d+)\.index\.js/);
  if (chunkMatch) {
    return `@cursor/sdk installation is incomplete (missing ${chunkMatch[1]}.index.js). ${REINSTALL_HINT}`;
  }

  return message;
}
