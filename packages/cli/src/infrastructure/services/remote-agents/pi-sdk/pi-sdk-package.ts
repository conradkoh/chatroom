import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as PiCodingAgentModule from '@earendil-works/pi-coding-agent';

type LoadedPiSdk = typeof PiCodingAgentModule;

const PI_CODING_AGENT_PKG = '@earendil-works/pi-coding-agent';
const REINSTALL_HINT = 'Reinstall chatroom-cli: npm install -g chatroom-cli@latest';

class PiSdkPackageError extends Error {
  readonly code = 'PI_SDK_PACKAGE_INCOMPLETE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'PiSdkPackageError';
  }
}

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

  throw new PiSdkPackageError(
    `Could not locate chatroom-cli package root while resolving ${PI_CODING_AGENT_PKG}. ${REINSTALL_HINT}`
  );
}

function readPinnedSdkVersion(chatroomCliRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(chatroomCliRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const specifier = pkg.dependencies?.[PI_CODING_AGENT_PKG];
  const pinned = specifier?.replace(/^[\^~>=<]+/, '').trim() ?? '';
  const match = pinned.match(/^(\d+\.\d+\.\d+)/);

  if (!match) {
    throw new PiSdkPackageError(
      `chatroom-cli must pin an exact ${PI_CODING_AGENT_PKG} version (found "${specifier ?? 'none'}"). ${REINSTALL_HINT}`
    );
  }

  return match[1];
}

function readInstalledSdkVersion(entryPath: string): string {
  const packageJsonPath = join(dirname(entryPath), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
  return pkg.version;
}

function resolvePiSdkEntryPathFromNodeModules(chatroomCliRoot: string): string | undefined {
  let dir = chatroomCliRoot;
  while (dir !== dirname(dir)) {
    const entryPath = join(dir, 'node_modules', PI_CODING_AGENT_PKG, 'dist', 'index.js');
    if (existsSync(entryPath)) {
      return entryPath;
    }
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * Resolve the ESM entry for @earendil-works/pi-coding-agent.
 *
 * The package is import-only in its exports map (no "require" condition), so
 * require.resolve() fails. Prefer import.meta.resolve() in Node; fall back to
 * node_modules layout for test runners that stub import.meta.resolve.
 */
function resolvePiSdkEntryPath(chatroomCliRoot: string): string {
  const resolveMeta = (
    import.meta as ImportMeta & { resolve?: (specifier: string, parent?: string) => string }
  ).resolve;

  if (typeof resolveMeta === 'function') {
    try {
      const parentUrl = pathToFileURL(join(chatroomCliRoot, 'package.json')).href;
      return fileURLToPath(resolveMeta(PI_CODING_AGENT_PKG, parentUrl));
    } catch {
      // Fall through to node_modules lookup.
    }
  }

  const entryPath = resolvePiSdkEntryPathFromNodeModules(chatroomCliRoot);
  if (entryPath) {
    return entryPath;
  }

  throw new PiSdkPackageError(
    `Could not resolve ${PI_CODING_AGENT_PKG} from ${chatroomCliRoot}. ${REINSTALL_HINT}`
  );
}

export async function importBundledPiSdk(
  moduleRef: string = import.meta.url
): Promise<LoadedPiSdk> {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const pinnedVersion = readPinnedSdkVersion(chatroomCliRoot);
  const entryPath = resolvePiSdkEntryPath(chatroomCliRoot);
  const installedVersion = readInstalledSdkVersion(entryPath);

  if (installedVersion !== pinnedVersion) {
    throw new PiSdkPackageError(
      `${PI_CODING_AGENT_PKG}@${installedVersion} does not match chatroom-cli pin (${pinnedVersion}). ${REINSTALL_HINT}`
    );
  }

  if (!existsSync(entryPath)) {
    throw new PiSdkPackageError(
      `${PI_CODING_AGENT_PKG} entry file is missing: ${entryPath}. ${REINSTALL_HINT}`
    );
  }

  return import(pathToFileURL(entryPath).href);
}

export function getBundledPiSdkVersion(moduleRef: string = import.meta.url): string {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  return readInstalledSdkVersion(resolvePiSdkEntryPath(chatroomCliRoot));
}

export function formatPiSdkLoadError(err: unknown): string {
  if (err instanceof PiSdkPackageError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
