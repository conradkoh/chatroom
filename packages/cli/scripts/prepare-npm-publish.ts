/**
 * Prepare a flat npm staging directory for publishing chatroom-cli.
 *
 * @see publish-common.ts for background on why this pipeline exists.
 *
 * ## Steps
 *
 * 1. **Publish manifest** — strip `devDependencies` and workspace-only scripts so
 *    plain `npm install` works in staging (no `workspace:*` protocol).
 * 2. **Flat install** — `npm install --omit=dev` in `.npm-publish/` produces real
 *    files, not pnpm symlinks into `.pnpm/`.
 * 3. **SDK bundle repack** — npm@11 cannot `npm pack` scoped `bundledDependencies`
 *    (`@cursor/sdk` fails with exit 1). Workaround: pack without bundling, extract,
 *    copy `node_modules/@cursor/sdk` into the tarball, repack as `.bundled.tgz`.
 * 4. **Verify** — delegate to verify-publish-artifacts.ts before anyone publishes.
 *
 * ## Flags
 *
 * - `--skip-build` — CI already ran `pnpm turbo build`; skip rebuild if dist exists
 * - `--no-bundle-cursor-sdk` — publish without manual SDK repack (exact pin only)
 *
 * ## Publish command (from `.npm-publish/`)
 *
 *   npm publish chatroom-cli-<version>.bundled.tgz --access public --ignore-scripts
 *
 * `--ignore-scripts` because build/test already ran in the monorepo; staging must not
 * re-run hooks that reference pnpm or workspace packages.
 */
import { execSync, type ExecSyncOptions } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { cliRoot, type PublishPackageJson } from './publish-common.js';

const stagingDir = join(cliRoot, '.npm-publish');
const repackDir = join(cliRoot, '.npm-publish-repack');
const verifyScript = join(cliRoot, 'scripts', 'verify-publish-artifacts.ts');

interface PrepareArgs {
  bundleCursorSdk: boolean;
  skipBuild: boolean;
}

function parseArgs(argv: string[]): PrepareArgs {
  let bundleCursorSdk = true;
  let skipBuild = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-bundle-cursor-sdk') {
      bundleCursorSdk = false;
      continue;
    }
    if (arg === '--skip-build') {
      skipBuild = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { bundleCursorSdk, skipBuild };
}

function run(cmd: string, opts: ExecSyncOptions = {}): void {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function readPublishManifest(): PublishPackageJson {
  const source = JSON.parse(
    readFileSync(join(cliRoot, 'package.json'), 'utf8')
  ) as PublishPackageJson;
  const manifest: PublishPackageJson = {
    ...source,
    // Published tarball must not ship dev tooling or workspace protocol deps.
    scripts: {},
    devDependencies: undefined,
  };

  // npm does not install transitive deps of bundled packages. @cursor/sdk@1.0.19+
  // dynamically imports @connectrpc/connect-node at runtime; promote it so global
  // installs resolve the transport module.
  if (manifest.bundledDependencies?.includes('@cursor/sdk')) {
    manifest.dependencies = {
      ...manifest.dependencies,
      '@connectrpc/connect-node': manifest.dependencies?.['@connectrpc/connect-node'] ?? '^1.6.1',
    };
  }

  return manifest;
}

function ensureBuilt(skipBuild: boolean): void {
  const distEntry = join(cliRoot, 'dist', 'index.js');
  if (existsSync(distEntry)) {
    return;
  }
  if (skipBuild) {
    throw new Error('dist/index.js is missing. Build chatroom-cli before publishing.');
  }
  run('pnpm build', { cwd: cliRoot });
}

function prepareStaging(manifest: PublishPackageJson): void {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  cpSync(join(cliRoot, 'dist'), join(stagingDir, 'dist'), { recursive: true });
  cpSync(join(cliRoot, 'README.md'), join(stagingDir, 'README.md'));
  writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // npm (not pnpm) so node_modules contains real directories for pack/repack.
  run('npm install --omit=dev --no-package-lock --no-audit --no-fund', {
    cwd: stagingDir,
    env: { ...process.env, CI: 'true' },
  });
}

function createBundledTarball(version: string): string {
  const baseTarball = join(stagingDir, `chatroom-cli-${version}.tgz`);
  rmSync(baseTarball, { force: true });

  const manifest = JSON.parse(
    readFileSync(join(stagingDir, 'package.json'), 'utf8')
  ) as PublishPackageJson;

  // npm pack fails when bundledDependencies lists @cursor/sdk (scoped package bug).
  // Pack without bundling, then inject the SDK tree manually below.
  const publishManifest: PublishPackageJson = { ...manifest };
  delete publishManifest.bundledDependencies;
  writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(publishManifest, null, 2)}\n`);

  run('npm pack --ignore-scripts', { cwd: stagingDir });
  writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(repackDir, { recursive: true, force: true });
  mkdirSync(repackDir, { recursive: true });
  run(`tar -xzf ${JSON.stringify(baseTarball)} -C ${JSON.stringify(repackDir)}`, {
    cwd: stagingDir,
  });

  const bundledSdkSrc = join(stagingDir, 'node_modules', '@cursor', 'sdk');
  const bundledSdkDest = join(repackDir, 'package', 'node_modules', '@cursor', 'sdk');
  mkdirSync(join(repackDir, 'package', 'node_modules', '@cursor'), { recursive: true });
  cpSync(bundledSdkSrc, bundledSdkDest, {
    recursive: true,
    // macOS archive metadata (._*) breaks tarball consumers.
    filter: (src) => {
      const base = basename(src);
      return base !== '.' && base !== '..' && !base.startsWith('.');
    },
  });

  const bundledTarball = join(stagingDir, `chatroom-cli-${version}.bundled.tgz`);
  rmSync(bundledTarball, { force: true });
  run(`tar -czf ${JSON.stringify(bundledTarball)} package`, { cwd: repackDir });

  rmSync(baseTarball, { force: true });
  return bundledTarball;
}

function runVerify(extraArgs = ''): void {
  run(`bun run ${JSON.stringify(verifyScript)}${extraArgs}`, { cwd: cliRoot });
}

const { bundleCursorSdk, skipBuild } = parseArgs(process.argv);
ensureBuilt(skipBuild);

const manifest = readPublishManifest();
prepareStaging(manifest);

let tarball: string | undefined;
if (bundleCursorSdk && manifest.bundledDependencies?.includes('@cursor/sdk')) {
  tarball = createBundledTarball(manifest.version);
  console.log(`Created bundled tarball: ${tarball}`);
} else if (bundleCursorSdk) {
  console.warn('Skipping SDK bundle repack: @cursor/sdk is not listed in bundledDependencies.');
}

runVerify();
if (tarball) {
  runVerify(` --tarball ${JSON.stringify(tarball)}`);
}

// Marker for guard-workspace-publish.ts after a successful prepare.
writeFileSync(join(stagingDir, '.publish-ready'), `${new Date().toISOString()}\n`);
console.log(`\nStaging ready: ${stagingDir}`);
if (tarball) {
  console.log(`Publish with: npm publish ${tarball} --access public --ignore-scripts`);
} else {
  console.log('Publish with: npm publish --access public --ignore-scripts');
}
