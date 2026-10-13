import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { TEMPLATE_REPO_URL } from './template-repo';

// The gate runs on import and reads the repo from the current working directory,
// so each case drives the real script against a throwaway fork repository.
const GATE_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'check-upstream-modifications.ts'
);
const FORK_REMOTE_URL = 'https://github.com/someone-else/forked-app.git';

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function writeRepoFile(root: string, filePath: string, content: string): void {
  const absolutePath = join(root, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

/**
 * Initializes a fork whose `upstream` remote is the template repo, with the given files
 * committed as `upstream/master`.
 */
function createForkWithUpstreamFiles(root: string, files: Record<string, string>): void {
  git(root, 'init', '-q', '-b', 'master');
  git(root, 'remote', 'add', 'origin', FORK_REMOTE_URL);
  git(root, 'remote', 'add', 'upstream', TEMPLATE_REPO_URL);
  for (const [filePath, content] of Object.entries(files)) {
    writeRepoFile(root, filePath, content);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'upstream baseline');
  // Stand in for a fetched `upstream/master` without touching the network.
  git(root, 'update-ref', 'refs/remotes/upstream/master', 'HEAD');
}

function runGate(root: string): { status: number | null; output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' };
  delete env.UPSTREAM_MODIFY_ACKNOWLEDGED;
  const result = spawnSync(process.execPath, [GATE_SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const BASELINE_FILES = {
  'package.json': '{"name":"root"}\n',
  'services/backend/package.json': '{"name":"backend"}\n',
  'src/app.ts': 'export const app = 1;\n',
  'services/backend/convex/schema.ts': 'export default {};\n',
  'services/backend/convex/sessions.ts': 'export const sessions = 1;\n',
};

describe('check-upstream-modifications gate', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'upstream-gate-'));
    createForkWithUpstreamFiles(root, BASELINE_FILES);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('does not block a staged root package.json', () => {
    writeRepoFile(root, 'package.json', '{"name":"root","scripts":{"x":"y"}}\n');
    git(root, 'add', 'package.json');

    expect(runGate(root).status).toBe(0);
  });

  it('does not block a staged nested package.json', () => {
    writeRepoFile(
      root,
      'services/backend/package.json',
      '{"name":"backend","scripts":{"test":"vitest"}}\n'
    );
    git(root, 'add', 'services/backend/package.json');

    expect(runGate(root).status).toBe(0);
  });

  it('does not block a staged convex schema', () => {
    writeRepoFile(root, 'services/backend/convex/schema.ts', 'export default { tables: {} };\n');
    git(root, 'add', 'services/backend/convex/schema.ts');

    expect(runGate(root).status).toBe(0);
  });

  it('still blocks a staged convex file that is not the schema', () => {
    writeRepoFile(root, 'services/backend/convex/sessions.ts', 'export const sessions = 2;\n');
    git(root, 'add', 'services/backend/convex/sessions.ts');

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    expect(output).toContain('services/backend/convex/sessions.ts');
  });

  it('still blocks a staged upstream file that is not a package.json', () => {
    writeRepoFile(root, 'src/app.ts', 'export const app = 2;\n');
    git(root, 'add', 'src/app.ts');

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    expect(output).toContain('src/app.ts');
  });

  it('blocks only the non-package.json files when both kinds are staged', () => {
    writeRepoFile(root, 'services/backend/package.json', '{"name":"backend","scripts":{}}\n');
    writeRepoFile(root, 'src/app.ts', 'export const app = 2;\n');
    git(root, 'add', 'services/backend/package.json', 'src/app.ts');

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    expect(output).toContain('- src/app.ts');
    expect(output).not.toContain('services/backend/package.json');
  });
});
