import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as CodexSdkModule from '@openai/codex-sdk';

type LoadedCodexSdk = typeof CodexSdkModule;

const REINSTALL_HINT = 'Reinstall chatroom-cli: npm install -g chatroom-cli@latest';

class CodexSdkPackageError extends Error {
  readonly code = 'CODEX_SDK_PACKAGE_INCOMPLETE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CodexSdkPackageError';
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

  throw new CodexSdkPackageError(
    `Could not locate chatroom-cli package root while resolving @openai/codex-sdk. ${REINSTALL_HINT}`
  );
}

// fallow-ignore-next-line complexity
function readPinnedSdkVersion(chatroomCliRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(chatroomCliRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const specifier = pkg.dependencies?.['@openai/codex-sdk'];
  const pinned = specifier?.replace(/^[\^~>=<]+/, '').trim() ?? '';
  const match = pinned.match(/^(\d+\.\d+\.\d+)/);

  if (!match) {
    throw new CodexSdkPackageError(
      `chatroom-cli must pin an exact @openai/codex-sdk version (found "${specifier ?? 'none'}"). ${REINSTALL_HINT}`
    );
  }

  return match[1];
}

function readInstalledSdkVersion(packageJsonPath: string): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
  return pkg.version;
}

/**
 * Locate @openai/codex-sdk/package.json from the chatroom-cli install.
 *
 * The SDK's exports map only exposes the `import` condition (no `./package.json`
 * subpath), so `require.resolve` subpath resolution throws. Fall back to the
 * direct `node_modules/@openai/codex-sdk` layout (npm and pnpm both symlink it
 * into the package's own node_modules).
 */
function resolveCodexSdkPackageJson(chatroomCliRoot: string): string {
  const require = createRequire(join(chatroomCliRoot, 'package.json'));
  try {
    return require.resolve('@openai/codex-sdk/package.json', { paths: [chatroomCliRoot] });
  } catch {
    const candidate = join(chatroomCliRoot, 'node_modules', '@openai', 'codex-sdk', 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    throw new CodexSdkPackageError(
      `Could not locate @openai/codex-sdk package.json from ${chatroomCliRoot}. ${REINSTALL_HINT}`
    );
  }
}

/**
 * Resolve and import @openai/codex-sdk from this chatroom-cli install.
 *
 * The SDK is ESM-only and bundles its Codex CLI runtime via `@openai/codex`,
 * so the import is deferred to call sites (isInstalled / spawn) and load
 * failures hide the harness instead of crashing the daemon.
 */
// fallow-ignore-next-line complexity
export async function importBundledCodexSdk(
  moduleRef: string = import.meta.url
): Promise<LoadedCodexSdk> {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const pinnedVersion = readPinnedSdkVersion(chatroomCliRoot);
  const packageJsonPath = resolveCodexSdkPackageJson(chatroomCliRoot);
  const installedVersion = readInstalledSdkVersion(packageJsonPath);

  if (installedVersion !== pinnedVersion) {
    throw new CodexSdkPackageError(
      `@openai/codex-sdk@${installedVersion} does not match chatroom-cli pin (${pinnedVersion}). ${REINSTALL_HINT}`
    );
  }

  const entryPath = join(dirname(packageJsonPath), 'dist', 'index.js');
  if (!existsSync(entryPath)) {
    throw new CodexSdkPackageError(
      `@openai/codex-sdk entry file is missing: ${entryPath}. ${REINSTALL_HINT}`
    );
  }

  return import(pathToFileURL(entryPath).href);
}

export function getBundledCodexSdkVersion(moduleRef: string = import.meta.url): string {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  return readInstalledSdkVersion(resolveCodexSdkPackageJson(chatroomCliRoot));
}

// fallow-ignore-next-line complexity
export function formatCodexSdkError(err: unknown): string {
  if (err instanceof Error) {
    const sdkErr = err as Error & { code?: string; name?: string };
    const code = sdkErr.code ? `[${sdkErr.code}] ` : '';
    const name = sdkErr.name && sdkErr.name !== 'Error' ? `${sdkErr.name}: ` : '';
    return `${name}${code}${err.message}`.trim();
  }
  return String(err);
}

export function formatCodexSdkLoadError(err: unknown): string {
  if (err instanceof CodexSdkPackageError) {
    return err.message;
  }
  return formatCodexSdkError(err);
}
