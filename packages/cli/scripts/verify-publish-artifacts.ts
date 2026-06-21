/**
 * Preflight checks for chatroom-cli publish artifacts.
 *
 * Run after `publish:prepare` and before `npm publish`. Catches regressions that
 * would only surface on end-user global installs:
 *
 * - **Exact @cursor/sdk pin** — caret ranges let npm resolve a newer broken SDK
 * - **SDK ESM entry** — @cursor/sdk@1.0.19+ ships dist/esm/index.js (no 745 chunk)
 * - **@connectrpc/connect-node** — SDK dynamically imports this for agent streams;
 *   when `@cursor/sdk` is bundled, npm does not install its transitive deps
 * - **Bundled tarball layout** — manual repack must place SDK under
 *   `package/node_modules/@cursor/sdk/` in the `.bundled.tgz`
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

function verifyStagingDir(dir: string): void {
  const pkgPath = join(dir, 'package.json');
  assert(existsSync(pkgPath), `Missing package.json in ${dir}`);
  assert(existsSync(join(dir, 'dist', 'index.js')), `Missing dist/index.js in ${dir}`);
  assert(existsSync(join(dir, 'dist', 'node-launch.js')), `Missing dist/node-launch.js in ${dir}`);

  const pkg = readJson(pkgPath);
  const sdkSpecifier = pkg.dependencies?.['@cursor/sdk'];
  assert(typeof sdkSpecifier === 'string', '@cursor/sdk must be listed in dependencies');
  // Exact pin: bundled tarball must not float to a different SDK at consumer install time.
  assert(
    !/^[\^~]/.test(sdkSpecifier),
    `@cursor/sdk must be exact-pinned (found "${sdkSpecifier}")`
  );

  const require = createRequire(join(dir, 'package.json'));
  const sdkEntry = require.resolve('@cursor/sdk', { paths: [dir] });
  const sdkDistDir = join(dirname(sdkEntry), '..', 'esm');
  assert(
    existsSync(join(sdkDistDir, 'index.js')),
    '@cursor/sdk is missing dist/esm/index.js (broken publish)'
  );

  if (pkg.bundledDependencies?.includes('@cursor/sdk')) {
    assert(
      pkg.dependencies?.['@connectrpc/connect-node'],
      'When @cursor/sdk is bundled, @connectrpc/connect-node must be a direct dependency of chatroom-cli'
    );
    require.resolve('@connectrpc/connect-node', { paths: [dir] });
  }

  console.log(`Publish artifacts OK (${dir})`);
  console.log(`  @cursor/sdk entry: ${sdkEntry}`);
  console.log('  dist/esm/index.js: present');
}

function verifyTarball(tarball: string): void {
  assert(existsSync(tarball), `Tarball not found: ${tarball}`);
  const output = execSync(`tar -tzf ${JSON.stringify(tarball)}`, { encoding: 'utf8' });
  assert(output.includes('package/dist/index.js'), 'Tarball missing package/dist/index.js');
  assert(
    output.includes('package/dist/node-launch.js'),
    'Tarball missing package/dist/node-launch.js'
  );
  assert(
    output.includes('package/node_modules/@cursor/sdk/dist/esm/index.js'),
    'Tarball missing bundled @cursor/sdk ESM entry'
  );
  console.log(`Tarball OK (${tarball})`);
}

const { dir, tarball } = parseArgs(process.argv);
verifyStagingDir(dir);
if (tarball) {
  verifyTarball(tarball);
}
