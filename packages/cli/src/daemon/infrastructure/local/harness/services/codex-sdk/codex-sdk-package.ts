import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as CodexSdkModule from '@openai/codex-sdk';

type LoadedCodexSdk = typeof CodexSdkModule;

const REINSTALL_HINT = 'Reinstall chatroom-cli: npm install -g chatroom-cli@latest';

const CODEX_NPM_NAME = '@openai/codex';

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

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

// fallow-ignore-next-line complexity
function resolveTargetTriple(): string {
  const { platform, arch } = process;
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-musl';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc';

  throw new CodexSdkPackageError(
    `Unsupported platform for ${CODEX_NPM_NAME}: ${platform}-${arch}. ${REINSTALL_HINT}`
  );
}

function resolvePlatformPackageName(targetTriple: string): string {
  const pkg = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  if (!pkg) {
    throw new CodexSdkPackageError(
      `Unsupported platform for ${CODEX_NPM_NAME}: ${targetTriple}. ${REINSTALL_HINT}`
    );
  }
  return pkg;
}

let cachedExecutablePath: string | undefined;

// fallow-ignore-next-line complexity
export function resolveCodexExecutablePath(moduleRef: string = import.meta.url): string {
  if (cachedExecutablePath) return cachedExecutablePath;

  const chatroomCliRoot = resolveChatroomCliRoot(moduleRef);
  const require = createRequire(join(chatroomCliRoot, 'package.json'));

  let codexPackageDir: string;
  try {
    codexPackageDir = dirname(
      require.resolve(`${CODEX_NPM_NAME}/package.json`, { paths: [chatroomCliRoot] })
    );
  } catch {
    throw new CodexSdkPackageError(
      `${CODEX_NPM_NAME} is not installed. Ensure chatroom-cli was installed with optional dependencies. ${REINSTALL_HINT}`
    );
  }

  const targetTriple = resolveTargetTriple();
  const platformPkg = resolvePlatformPackageName(targetTriple);
  const codexBinaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';

  let platformPkgDir: string;
  try {
    // pnpm keeps optional platform packages nested under @openai/codex, while
    // npm's flattened global installs expose them from the CLI root. Resolve
    // from both locations so workspace-linked and published installs work.
    const platformPackageJson = [codexPackageDir, chatroomCliRoot]
      .map((resolveFrom) => {
        try {
          return require.resolve(`${platformPkg}/package.json`, { paths: [resolveFrom] });
        } catch {
          return undefined;
        }
      })
      .find((resolved) => resolved !== undefined);

    if (!platformPackageJson) {
      throw new Error(`Unable to resolve ${platformPkg}`);
    }
    platformPkgDir = dirname(platformPackageJson);
  } catch {
    throw new CodexSdkPackageError(
      `Native Codex CLI package ${platformPkg} is not installed. Ensure ${CODEX_NPM_NAME} is installed with optional dependencies. ${REINSTALL_HINT}`
    );
  }

  const packageBinaryPath = join(platformPkgDir, 'vendor', targetTriple, 'bin', codexBinaryName);
  const legacyBinaryPath = join(platformPkgDir, 'vendor', targetTriple, 'codex', codexBinaryName);

  if (existsSync(packageBinaryPath)) {
    cachedExecutablePath = packageBinaryPath;
    return cachedExecutablePath;
  }
  if (existsSync(legacyBinaryPath)) {
    cachedExecutablePath = legacyBinaryPath;
    return cachedExecutablePath;
  }

  throw new CodexSdkPackageError(
    `Unable to locate Codex CLI binaries for ${targetTriple}. Ensure ${CODEX_NPM_NAME} is installed with optional dependencies. ${REINSTALL_HINT}`
  );
}

/** @internal Test-only reset for cached executable path. */
export function resetCodexExecutablePathCacheForTests(): void {
  cachedExecutablePath = undefined;
}

/**
 * Resolve and import @openai/codex-sdk from this chatroom-cli install.
 *
 * Uses require.resolve(..., { paths: [chatroomCliRoot] }) so npm global installs
 * use the copy installed with chatroom-cli, not a separately hoisted global package.
 * The SDK is ESM-only; import is deferred to call sites (isInstalled / spawn) and
 * load failures hide the harness instead of crashing the daemon.
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

  const distEntryPath = join(dirname(packageJsonPath), 'dist', 'index.js');
  if (!existsSync(distEntryPath)) {
    throw new CodexSdkPackageError(
      `@openai/codex-sdk entry file is missing: ${distEntryPath}. ${REINSTALL_HINT}`
    );
  }

  return import(pathToFileURL(distEntryPath).href);
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

// fallow-ignore-next-line complexity
export function formatCodexSdkLoadError(err: unknown): string {
  if (err instanceof CodexSdkPackageError) {
    const message = err.message;
    if (
      (message.includes('Codex CLI') || message.includes('optional dependencies')) &&
      !message.includes(REINSTALL_HINT)
    ) {
      return `${message} ${REINSTALL_HINT}`;
    }
    return message;
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('Codex CLI') || message.includes('optional dependencies')) {
    return `${message} ${REINSTALL_HINT}`;
  }

  return formatCodexSdkError(err);
}
