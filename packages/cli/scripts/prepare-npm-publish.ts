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
 * 3. **Pack** — `npm pack` produces a tarball with dist/ and node_modules/.
 * 4. **Verify** — delegate to verify-publish-artifacts.ts before anyone publishes.
 *
 * ## Flags
 *
 * - `--skip-build` — CI already ran `pnpm turbo build`; skip rebuild if dist exists
 *
 * ## Publish command (from `.npm-publish/`)
 *
 *   npm publish chatroom-cli-<version>.tgz --access public --ignore-scripts
 *
 * `--ignore-scripts` because build/test already ran in the monorepo; staging must not
 * re-run hooks that reference pnpm or workspace packages.
 */
import { execSync, type ExecSyncOptions } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { cliRoot, type PublishPackageJson } from './publish-common.js';

const stagingDir = join(cliRoot, '.npm-publish');
const verifyScript = join(cliRoot, 'scripts', 'verify-publish-artifacts.ts');

interface PrepareArgs {
  skipBuild: boolean;
}

function parseArgs(argv: string[]): PrepareArgs {
  let skipBuild = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-build') {
      skipBuild = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { skipBuild };
}

function run(cmd: string, opts: ExecSyncOptions = {}): void {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function readPublishManifest(): PublishPackageJson {
  const source = JSON.parse(
    readFileSync(join(cliRoot, 'package.json'), 'utf8')
  ) as PublishPackageJson;
  return {
    ...source,
    // Published tarball must not ship dev tooling or workspace protocol deps.
    scripts: {},
    devDependencies: undefined,
    bundledDependencies: undefined,
  };
}

function ensureBuilt(skipBuild: boolean): void {
  const distEntry = join(cliRoot, 'dist', 'index.js');
  const launchEntry = join(cliRoot, 'dist', 'node-launch.js');
  if (existsSync(distEntry) && existsSync(launchEntry)) {
    return;
  }
  if (skipBuild) {
    throw new Error(
      'dist/index.js or dist/node-launch.js is missing. Build chatroom-cli before publishing.'
    );
  }
  run('pnpm build', { cwd: cliRoot });
}

function prepareStaging(manifest: PublishPackageJson): void {
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  cpSync(join(cliRoot, 'dist'), join(stagingDir, 'dist'), { recursive: true });
  cpSync(join(cliRoot, 'README.md'), join(stagingDir, 'README.md'));
  writeFileSync(join(stagingDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // npm (not pnpm) so node_modules contains real directories for pack.
  run('npm install --omit=dev --no-package-lock --no-audit --no-fund', {
    cwd: stagingDir,
    env: { ...process.env, CI: 'true' },
  });
}

function createTarball(version: string): string {
  const tarball = join(stagingDir, `chatroom-cli-${version}.tgz`);
  rmSync(tarball, { force: true });
  run('npm pack --ignore-scripts', { cwd: stagingDir });
  if (!existsSync(tarball)) {
    throw new Error(`Expected npm pack to create ${tarball}`);
  }
  return tarball;
}

function runVerify(extraArgs = ''): void {
  run(`bun run ${JSON.stringify(verifyScript)}${extraArgs}`, { cwd: cliRoot });
}

const { skipBuild } = parseArgs(process.argv);
ensureBuilt(skipBuild);

const manifest = readPublishManifest();
prepareStaging(manifest);

const tarball = createTarball(manifest.version);
console.log(`Created tarball: ${tarball}`);

runVerify();
runVerify(` --tarball ${JSON.stringify(tarball)}`);

// Marker for guard-workspace-publish.ts after a successful prepare.
writeFileSync(join(stagingDir, '.publish-ready'), `${new Date().toISOString()}\n`);
console.log(`\nStaging ready: ${stagingDir}`);
console.log(`Publish with: npm publish ${tarball} --access public --ignore-scripts`);
