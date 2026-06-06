/**
 * Preflight checks for chatroom-cli publish artifacts.
 *
 * Run after `publish:prepare` and before `npm publish`. Catches regressions that
 * would only surface on end-user global installs:
 *
 * - **Exact @cursor/sdk pin** — caret ranges let npm resolve a newer broken SDK
 * - **745.index.js** — webpack chunk required by `Agent.create({ fast: false })`;
 *   missing in SDK 1.0.14–1.0.17 tarballs
 * - **sqlite3 native binary** — when `@cursor/sdk` is bundled, npm does not install
 *   the SDK's transitive deps; chatroom-cli must depend on `sqlite3` directly so
 *   the `.node` addon is built for the publish runner's platform
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
  // Runtime smoke for the webpack chunk mismatch that broke cursor-sdk harness turns.
  assert(
    existsSync(join(sdkDistDir, '745.index.js')),
    '@cursor/sdk is missing dist/esm/745.index.js (broken publish)'
  );

  if (pkg.bundledDependencies?.includes('@cursor/sdk')) {
    assert(
      pkg.dependencies?.sqlite3,
      'When @cursor/sdk is bundled, sqlite3 must be a direct dependency of chatroom-cli'
    );
    const sqliteRoot = dirname(require.resolve('sqlite3/package.json', { paths: [dir] }));
    const sqliteNode = join(sqliteRoot, 'build', 'Release', 'node_sqlite3.node');
    // SDK imports sqlite3 as a native addon; bundling the SDK alone skips its dep tree.
    assert(
      existsSync(sqliteNode),
      `sqlite3 native binary missing at ${sqliteNode} (run npm install in staging)`
    );
  }

  console.log(`Publish artifacts OK (${dir})`);
  console.log(`  @cursor/sdk entry: ${sdkEntry}`);
  console.log('  745.index.js: present');
}

function verifyTarball(tarball: string): void {
  assert(existsSync(tarball), `Tarball not found: ${tarball}`);
  const output = execSync(`tar -tzf ${JSON.stringify(tarball)}`, { encoding: 'utf8' });
  assert(output.includes('package/dist/index.js'), 'Tarball missing package/dist/index.js');
  assert(
    output.includes('package/node_modules/@cursor/sdk/dist/esm/745.index.js'),
    'Tarball missing bundled @cursor/sdk chunk 745.index.js'
  );
  console.log(`Tarball OK (${tarball})`);
}

const { dir, tarball } = parseArgs(process.argv);
verifyStagingDir(dir);
if (tarball) {
  verifyTarball(tarball);
}
