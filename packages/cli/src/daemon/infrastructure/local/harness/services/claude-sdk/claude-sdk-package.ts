import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as ClaudeAgentSdkModule from '@anthropic-ai/claude-agent-sdk';

type LoadedClaudeSdk = typeof ClaudeAgentSdkModule;

const CLAUDE_AGENT_SDK_PKG = '@anthropic-ai/claude-agent-sdk';
const REINSTALL_HINT = 'Reinstall chatroom-cli: npm install -g chatroom-cli@latest';

class ClaudeSdkPackageError extends Error {
  readonly code = 'CLAUDE_SDK_PACKAGE_INCOMPLETE' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ClaudeSdkPackageError';
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

  throw new ClaudeSdkPackageError(
    `Could not locate chatroom-cli package root while resolving ${CLAUDE_AGENT_SDK_PKG}. ${REINSTALL_HINT}`
  );
}

// fallow-ignore-next-line complexity
function readPinnedSdkVersion(chatroomCliRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(chatroomCliRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const specifier = pkg.dependencies?.[CLAUDE_AGENT_SDK_PKG];
  const pinned = specifier?.replace(/^[\^~>=<]+/, '').trim() ?? '';
  const match = pinned.match(/^(\d+\.\d+\.\d+)/);

  if (!match) {
    throw new ClaudeSdkPackageError(
      `chatroom-cli must pin an exact ${CLAUDE_AGENT_SDK_PKG} version (found "${specifier ?? 'none'}"). ${REINSTALL_HINT}`
    );
  }

  return match[1];
}

function readInstalledSdkVersion(entryPath: string): string {
  const packageJsonPath = join(dirname(entryPath), 'package.json');
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
  return pkg.version;
}

function resolvePlatformPackageName(): string {
  const key = `${process.platform}-${process.arch}`;
  const map: Record<string, string> = {
    'darwin-arm64': '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    'darwin-x64': '@anthropic-ai/claude-agent-sdk-darwin-x64',
    'linux-arm64': '@anthropic-ai/claude-agent-sdk-linux-arm64',
    'linux-x64': '@anthropic-ai/claude-agent-sdk-linux-x64',
    'win32-arm64': '@anthropic-ai/claude-agent-sdk-win32-arm64',
    'win32-x64': '@anthropic-ai/claude-agent-sdk-win32-x64',
  };
  const pkg = map[key];
  if (!pkg) {
    throw new ClaudeSdkPackageError(
      `Unsupported platform for ${CLAUDE_AGENT_SDK_PKG}: ${key}. ${REINSTALL_HINT}`
    );
  }
  return pkg;
}

function resolveNativeCliBinaryPath(sdkEntryPath: string): string {
  const require = createRequire(sdkEntryPath);
  const platformPkg = resolvePlatformPackageName();
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';

  let pkgDir: string;
  try {
    pkgDir = dirname(require.resolve(`${platformPkg}/package.json`));
  } catch {
    throw new ClaudeSdkPackageError(
      `Native CLI binary package ${platformPkg} is not installed. ${REINSTALL_HINT}`
    );
  }

  const binaryPath = join(pkgDir, binaryName);
  if (!existsSync(binaryPath)) {
    throw new ClaudeSdkPackageError(
      `Native CLI binary is missing: ${binaryPath}. ${REINSTALL_HINT}`
    );
  }

  return binaryPath;
}

let cachedExecutablePath: string | undefined;

/**
 * Resolve pathToClaudeCodeExecutable for query() options.
 * Uses extractFromBunfs() so the same path works in dev and bun --compile bundles.
 */
export async function resolvePathToClaudeCodeExecutable(
  moduleRef: string = import.meta.url
): Promise<string> {
  if (cachedExecutablePath) return cachedExecutablePath;

  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const require = createRequire(join(chatroomCliRoot, 'package.json'));
  const sdkEntryPath = require.resolve(CLAUDE_AGENT_SDK_PKG, { paths: [chatroomCliRoot] });
  const embeddedPath = resolveNativeCliBinaryPath(sdkEntryPath);

  const { extractFromBunfs } = await import('@anthropic-ai/claude-agent-sdk/extract');
  cachedExecutablePath = extractFromBunfs(embeddedPath);
  return cachedExecutablePath;
}

/**
 * Resolve and import @anthropic-ai/claude-agent-sdk from this chatroom-cli install.
 */
export async function importBundledClaudeSdk(
  moduleRef: string = import.meta.url
): Promise<LoadedClaudeSdk> {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const require = createRequire(join(chatroomCliRoot, 'package.json'));
  const pinnedVersion = readPinnedSdkVersion(chatroomCliRoot);
  const entryPath = require.resolve(CLAUDE_AGENT_SDK_PKG, { paths: [chatroomCliRoot] });
  const installedVersion = readInstalledSdkVersion(entryPath);

  if (installedVersion !== pinnedVersion) {
    throw new ClaudeSdkPackageError(
      `${CLAUDE_AGENT_SDK_PKG}@${installedVersion} does not match chatroom-cli pin (${pinnedVersion}). ${REINSTALL_HINT}`
    );
  }

  if (!existsSync(entryPath)) {
    throw new ClaudeSdkPackageError(
      `${CLAUDE_AGENT_SDK_PKG} entry file is missing: ${entryPath}. ${REINSTALL_HINT}`
    );
  }

  return import(pathToFileURL(entryPath).href);
}

export function getBundledClaudeSdkVersion(moduleRef: string = import.meta.url): string {
  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const require = createRequire(join(chatroomCliRoot, 'package.json'));
  const entryPath = require.resolve(CLAUDE_AGENT_SDK_PKG, { paths: [chatroomCliRoot] });
  return readInstalledSdkVersion(entryPath);
}

export function formatClaudeSdkLoadError(err: unknown): string {
  if (err instanceof ClaudeSdkPackageError) {
    return err.message;
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Native CLI binary')) {
    return `${message} ${REINSTALL_HINT}`;
  }

  return message;
}
