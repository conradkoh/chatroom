import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CustomAgentsDeps } from './deps.js';
import { validateCustomAgents } from './index.js';
import { loadCustomAgentSource } from '../../infrastructure/services/custom-agents/index.js';

interface Harness {
  deps: CustomAgentsDeps;
  lines: string[];
  exitCodes: number[];
}

/** Real loader, real temp directories, captured output and exit code. */
function createHarness(cwd: string, homeDir: string): Harness {
  const lines: string[] = [];
  const exitCodes: number[] = [];
  return {
    lines,
    exitCodes,
    deps: {
      load: loadCustomAgentSource,
      cwd: () => cwd,
      homeDir: () => homeDir,
      stdout: (line) => lines.push(line),
      setExitCode: (code) => exitCodes.push(code),
    },
  };
}

async function writeAgent(root: string, name: string, body?: string): Promise<void> {
  const dir = join(root, '.chatroom', 'agents', name);
  await mkdir(dir, { recursive: true });
  const frontmatter =
    body === undefined
      ? `---\nname: ${name}\ndescription: ${name} role.\n---\nYou are ${name}.\n`
      : body;
  await writeFile(join(dir, 'AGENT.md'), frontmatter);
}

function exitCodeOf(harness: Harness): number | undefined {
  return harness.exitCodes.at(-1);
}

describe('custom-agents validate', () => {
  let tmp: string;
  let workspace: string;
  let home: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'custom-agents-validate-'));
    workspace = join(tmp, 'workspace');
    home = join(tmp, 'home');
    await mkdir(workspace, { recursive: true });
    await mkdir(home, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('exits 0 and prints the agent for a clean workspace', async () => {
    await writeAgent(workspace, 'alpha');
    const harness = createHarness(workspace, home);

    await validateCustomAgents({ machine: false }, harness.deps);

    expect(exitCodeOf(harness)).toBe(0);
    const output = harness.lines.join('\n');
    expect(output).toContain(`workspace  ${workspace}`);
    expect(output).toContain('alpha  (workspace)  alpha role.');
  });

  it('exits 1 and prints the issue when an agent has no frontmatter', async () => {
    await writeAgent(workspace, 'broken', 'no frontmatter here\n');
    const harness = createHarness(workspace, home);

    await validateCustomAgents({ machine: false }, harness.deps);

    expect(exitCodeOf(harness)).toBe(1);
    const output = harness.lines.join('\n');
    expect(output).toContain('missing-frontmatter  broken/AGENT.md');
  });

  it('validates only the machine source with --machine', async () => {
    await writeAgent(workspace, 'workspace-agent');
    await writeAgent(home, 'machine-agent');
    const harness = createHarness(workspace, home);

    await validateCustomAgents({ machine: true }, harness.deps);

    const output = harness.lines.join('\n');
    expect(output).toContain(`machine  ${home}`);
    expect(output).toContain('machine-agent  (machine)  machine-agent role.');
    expect(output).not.toContain('workspace-agent');
    expect(exitCodeOf(harness)).toBe(0);
  });

  it('uses --workspace <dir> instead of the current directory', async () => {
    const other = join(tmp, 'other-workspace');
    await mkdir(other, { recursive: true });
    await writeAgent(other, 'other-agent');
    await writeAgent(workspace, 'cwd-agent');
    const harness = createHarness(workspace, home);

    await validateCustomAgents({ workspaceDir: other, machine: false }, harness.deps);

    const output = harness.lines.join('\n');
    expect(output).toContain(`workspace  ${other}`);
    expect(output).toContain('other-agent  (workspace)  other-agent role.');
    expect(output).not.toContain('cwd-agent');
    expect(exitCodeOf(harness)).toBe(0);
  });

  it('validates both sources when no flags are given', async () => {
    await writeAgent(workspace, 'workspace-agent');
    await writeAgent(home, 'machine-agent');
    const harness = createHarness(workspace, home);

    await validateCustomAgents({ machine: false }, harness.deps);

    const output = harness.lines.join('\n');
    expect(output).toContain(`workspace  ${workspace}`);
    expect(output).toContain(`machine  ${home}`);
    expect(exitCodeOf(harness)).toBe(0);
  });

  it('prints a placeholder for a source with no agents and no issues', async () => {
    const harness = createHarness(workspace, home);

    await validateCustomAgents({ machine: true }, harness.deps);

    expect(harness.lines.join('\n')).toContain('no agents or issues');
    expect(exitCodeOf(harness)).toBe(0);
  });
});
