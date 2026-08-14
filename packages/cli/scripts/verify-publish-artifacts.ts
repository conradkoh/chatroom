/**
 * Preflight checks for chatroom-cli publish artifacts.
 *
 * Run after `publish:prepare` and before `npm publish`. Catches regressions that
 * would only surface on end-user global installs:
 *
 * - **Exact @cursor/sdk pin** — caret ranges let npm resolve a newer broken SDK
 * - **SDK ESM entry** — @cursor/sdk ships dist/esm/index.js
 * - **@connectrpc/connect-node** — SDK dynamically imports this for agent streams
 * - **Scoped resolution** — same require.resolve paths importBundledCursorSdk uses
 * - **Codex CLI binary** — @openai/codex platform package must resolve from staging root
 *
 * @see publish-common.ts for the full pipeline rationale
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { assert, cliRoot, type PublishPackageJson } from './publish-common.js';

interface VerifyArgs {
  dir: string;
  tarball?: string;
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): VerifyArgs {
  let dir = join(cliRoot, '.npm-publish');
  let tarball: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir' && argv[i + 1]) {
      dir = argv[++i];
      continue;
    }
    if (arg === '--tarball' && argv[i + 1]) {
      tarball = argv[++i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { dir, tarball };
}

function readJson(path: string): PublishPackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PublishPackageJson;
}

const CODEX_PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

// fallow-ignore-next-line complexity
function resolveCodexTargetTriple(): string {
  const { platform, arch } = process;

  switch (platform) {
    case 'linux':
    case 'android':
      if (arch === 'x64') return 'x86_64-unknown-linux-musl';
      if (arch === 'arm64') return 'aarch64-unknown-linux-musl';
      break;
    case 'darwin':
      if (arch === 'x64') return 'x86_64-apple-darwin';
      if (arch === 'arm64') return 'aarch64-apple-darwin';
      break;
    case 'win32':
      if (arch === 'x64') return 'x86_64-pc-windows-msvc';
      if (arch === 'arm64') return 'aarch64-pc-windows-msvc';
      break;
    default:
      break;
  }

  throw new Error(`Unsupported platform for Codex CLI verification: ${platform} (${arch})`);
}

function resolveCodexVendorBinary(dir: string): string {
  const require = createRequire(join(dir, 'package.json'));
  const targetTriple = resolveCodexTargetTriple();
  const platformPkg = CODEX_PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  assert(platformPkg, `Unsupported Codex target triple: ${targetTriple}`);

  const platformPkgJson = require.resolve(`${platformPkg}/package.json`, { paths: [dir] });
  const codexBinaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  return join(dirname(platformPkgJson), 'vendor', targetTriple, 'bin', codexBinaryName);
}

function verifyStagingDir(dir: string): void {
  const pkgPath = join(dir, 'package.json');
  assert(existsSync(pkgPath), `Missing package.json in ${dir}`);
  assert(existsSync(join(dir, 'dist', 'index.js')), `Missing dist/index.js in ${dir}`);
  assert(existsSync(join(dir, 'dist', 'node-launch.js')), `Missing dist/node-launch.js in ${dir}`);
  assert(
    existsSync(join(dir, 'dist', 'client', 'build', 'index.html')),
    'Missing dist/client/build/index.html in publish staging'
  );

  const pkg = readJson(pkgPath);
  const sdkSpecifier = pkg.dependencies?.['@cursor/sdk'];
  assert(typeof sdkSpecifier === 'string', '@cursor/sdk must be listed in dependencies');
  assert(
    !/^[\^~]/.test(sdkSpecifier),
    `@cursor/sdk must be exact-pinned (found "${sdkSpecifier}")`
  );

  assert(
    pkg.dependencies?.['@connectrpc/connect-node'],
    '@connectrpc/connect-node must be a direct dependency of chatroom-cli'
  );

  const require = createRequire(join(dir, 'package.json'));
  const sdkEntry = require.resolve('@cursor/sdk', { paths: [dir] });
  const connectNodeEntry = require.resolve('@connectrpc/connect-node', { paths: [dir] });

  const sdkDistDir = join(dirname(sdkEntry), '..', 'esm');
  assert(
    existsSync(join(sdkDistDir, 'index.js')),
    '@cursor/sdk is missing dist/esm/index.js (broken publish)'
  );

  const pinnedVersion = sdkSpecifier.replace(/^[\^~>=<]+/, '').trim();
  const installedSdkPkg = readJson(join(dirname(sdkEntry), '..', '..', 'package.json'));
  assert(
    installedSdkPkg.version === pinnedVersion,
    `@cursor/sdk@${installedSdkPkg.version} does not match pin (${pinnedVersion})`
  );

  const codexSpecifier = pkg.dependencies?.['@openai/codex'];
  assert(typeof codexSpecifier === 'string', '@openai/codex must be listed in dependencies');
  assert(
    !/^[\^~]/.test(codexSpecifier),
    `@openai/codex must be exact-pinned (found "${codexSpecifier}")`
  );

  const codexVendorBinary = resolveCodexVendorBinary(dir);
  assert(
    existsSync(codexVendorBinary),
    `Codex CLI binary missing in publish staging: ${codexVendorBinary}`
  );

  console.log(`Publish artifacts OK (${dir})`);
  console.log(`  @cursor/sdk entry: ${sdkEntry}`);
  console.log(`  @connectrpc/connect-node entry: ${connectNodeEntry}`);
  console.log('  dist/esm/index.js: present');
  console.log(`  Codex CLI binary: ${codexVendorBinary}`);
}

function verifyTarball(tarball: string): void {
  assert(existsSync(tarball), `Tarball not found: ${tarball}`);
  const output = execSync(`tar -tzf ${JSON.stringify(tarball)}`, { encoding: 'utf8' });
  assert(output.includes('package/dist/index.js'), 'Tarball missing package/dist/index.js');
  assert(
    output.includes('package/dist/node-launch.js'),
    'Tarball missing package/dist/node-launch.js'
  );
  assert(output.includes('package/package.json'), 'Tarball missing package/package.json');
  const entries = output.split('\n');
  assert(
    entries.includes('package/dist/client/build/index.html'),
    'Tarball missing package/dist/client/build/index.html'
  );
  assert(
    entries.some(
      (entry) =>
        entry.startsWith('package/dist/client/build/assets/') && entry.endsWith('.js')
    ),
    'Tarball missing local-web JavaScript assets'
  );

  const pkgJson = execSync(`tar -xOf ${JSON.stringify(tarball)} package/package.json`, {
    encoding: 'utf8',
  });
  const pkg = JSON.parse(pkgJson) as PublishPackageJson;
  assert(pkg.dependencies?.['@cursor/sdk'], 'Tarball package.json missing @cursor/sdk dependency');
  assert(
    pkg.dependencies?.['@connectrpc/connect-node'],
    'Tarball package.json missing @connectrpc/connect-node dependency'
  );
  assert(
    pkg.dependencies?.['@openai/codex'],
    'Tarball package.json missing @openai/codex dependency'
  );

  console.log(`Tarball OK (${tarball})`);
}

const { dir, tarball } = parseArgs(process.argv);
verifyStagingDir(dir);
if (tarball) {
  verifyTarball(tarball);
}
