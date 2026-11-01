import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeCustomAgentContentHash,
  CUSTOM_AGENT_LIMITS,
} from '@workspace/shared/domain/custom-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOADER_MAX_ROOT_ENTRIES, loadCustomAgentSource } from './load-custom-agent-source.js';

const KIB = 1024;

interface AgentFiles {
  /** Frontmatter name; defaults to the directory name. */
  name?: string;
  description?: string;
  body?: string;
  /** Extra frontmatter lines, without a trailing newline. */
  extraFrontmatter?: string;
  inbound?: string;
  returned?: string;
}

async function writeAgent(
  workspaceRoot: string,
  dirName: string,
  files: AgentFiles = {}
): Promise<string> {
  const dir = join(workspaceRoot, '.chatroom', 'agents', dirName);
  await mkdir(dir, { recursive: true });

  const extra = files.extraFrontmatter === undefined ? '' : `${files.extraFrontmatter}\n`;
  const frontmatter = [
    '---',
    `name: ${files.name ?? dirName}`,
    `description: ${files.description ?? `${dirName} role.`}`,
    `${extra}---`,
  ].join('\n');
  const body = files.body ?? `You are ${dirName}.`;
  await writeFile(join(dir, 'AGENT.md'), `${frontmatter}\n${body}\n`);

  if (files.inbound !== undefined) {
    await writeFile(join(dir, 'inbound-handoff.md'), files.inbound);
  }
  if (files.returned !== undefined) {
    await writeFile(join(dir, 'return-handoff.md'), files.returned);
  }
  return dir;
}

describe('loadCustomAgentSource', () => {
  let tmp: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'custom-agents-loader-'));
    workspaceRoot = join(tmp, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('loads one agent with both optional handoff templates', async () => {
    await writeAgent(workspaceRoot, 'alpha', {
      body: 'You are alpha.',
      inbound: 'Inbound body.\n',
      returned: 'Return body.\n',
    });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.scope).toBe('workspace');
    expect(result.issues).toEqual([]);
    expect(result.agents).toEqual([
      {
        name: 'alpha',
        description: 'alpha role.',
        systemPrompt: 'You are alpha.',
        inboundHandoffTemplate: 'Inbound body.\n',
        returnHandoffTemplate: 'Return body.\n',
        contentHash: computeCustomAgentContentHash({
          name: 'alpha',
          description: 'alpha role.',
          systemPrompt: 'You are alpha.',
          inboundHandoffTemplate: 'Inbound body.\n',
          returnHandoffTemplate: 'Return body.\n',
        }),
      },
    ]);
  });

  it('omits absent template fields instead of setting them', async () => {
    await writeAgent(workspaceRoot, 'alpha');

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });
    const [agent] = result.agents;

    expect(agent).toBeDefined();
    expect(agent).not.toHaveProperty('inboundHandoffTemplate');
    expect(agent).not.toHaveProperty('returnHandoffTemplate');
  });

  it('hashes the sanitized description, matching what the backend stores', async () => {
    await writeAgent(workspaceRoot, 'alpha', { description: 'Alpha   role' });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });
    const [agent] = result.agents;

    expect(agent!.description).toBe('Alpha role');
    expect(agent!.contentHash).toBe(
      computeCustomAgentContentHash({
        name: 'alpha',
        description: 'Alpha role',
        systemPrompt: 'You are alpha.',
      })
    );
  });

  it('returns an empty source when the root is missing', async () => {
    await expect(loadCustomAgentSource({ scope: 'workspace', workspaceRoot })).resolves.toEqual({
      scope: 'workspace',
      agents: [],
      issues: [],
    });
  });

  it('reports a symlinked AGENT.md and a symlinked agent directory without reading either', async () => {
    const alphaDir = await writeAgent(workspaceRoot, 'alpha');
    const secret = join(tmp, 'secret.md');
    await writeFile(secret, '---\nname: alpha\ndescription: Secret.\n---\nSecret.\n');
    await rm(join(alphaDir, 'AGENT.md'));
    await symlink(secret, join(alphaDir, 'AGENT.md'));

    const outsideDir = join(tmp, 'outside', 'agents', 'beta');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(
      join(outsideDir, 'AGENT.md'),
      '---\nname: beta\ndescription: Beta.\n---\nBeta.\n'
    );
    await symlink(outsideDir, join(workspaceRoot, '.chatroom', 'agents', 'beta'));

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents).toEqual([]);
    expect(result.issues).toEqual([
      { path: 'alpha/AGENT.md', reason: 'unreadable', detail: 'symlink' },
      { path: 'beta', reason: 'unreadable', detail: 'symlink' },
    ]);
  });

  it('refuses a workspace root that resolves outside the workspace', async () => {
    const outside = join(tmp, 'outside');
    await writeAgent(outside, 'alpha');
    await symlink(join(outside, '.chatroom'), join(workspaceRoot, '.chatroom'));

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents).toEqual([]);
    expect(result.issues).toEqual([
      {
        path: '.chatroom/agents',
        reason: 'unreadable',
        detail: 'root-outside-workspace',
      },
    ]);
  });

  it('loads a symlinked machine root and keeps home out of its issues', async () => {
    const realHome = join(tmp, 'real-home');
    const home = join(tmp, 'home');
    await mkdir(home, { recursive: true });
    await writeAgent(realHome, 'alpha');
    await writeAgent(realHome, 'Bad_Name');
    await symlink(join(realHome, '.chatroom'), join(home, '.chatroom'));

    const result = await loadCustomAgentSource({ scope: 'machine', homeDir: home });

    expect(result.scope).toBe('machine');
    expect(result.agents.map(({ name }) => name)).toEqual(['alpha']);
    expect(result.issues).toEqual([{ path: 'Bad_Name/AGENT.md', reason: 'invalid-name' }]);
    expect(JSON.stringify(result)).not.toContain(home);
  });

  it('reports truncation after the maximum number of root entries', async () => {
    const agentsRoot = join(workspaceRoot, '.chatroom', 'agents');
    await mkdir(agentsRoot, { recursive: true });
    const names = Array.from(
      { length: LOADER_MAX_ROOT_ENTRIES + 1 },
      (_, index) => `agent-${String(index).padStart(2, '0')}`
    );
    for (const name of names) await mkdir(join(agentsRoot, name));

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.issues).toContainEqual({
      path: '.chatroom/agents',
      reason: 'root-truncated',
      detail: 'entries',
    });
    expect(result.issues.some(({ path }) => path === 'agent-64/AGENT.md')).toBe(false);
    expect(result.issues.length).toBeLessThanOrEqual(CUSTOM_AGENT_LIMITS.issuesPerSource);
  });

  it('keeps the first 12 agents by name and reports the overflow', async () => {
    for (let index = 0; index < 13; index++) {
      await writeAgent(workspaceRoot, `agent-${String(index).padStart(2, '0')}`);
    }

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents.map(({ name }) => name)).toEqual(
      Array.from({ length: 12 }, (_, index) => `agent-${String(index).padStart(2, '0')}`)
    );
    expect(result.issues).toEqual([
      { path: 'agent-12', reason: 'root-truncated', detail: 'agent cap 12' },
    ]);
  });

  it('rejects a directory whose frontmatter name differs from its directory', async () => {
    await writeAgent(workspaceRoot, 'alpha', { name: 'beta' });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents).toEqual([]);
    expect(result.issues).toEqual([{ path: 'alpha/AGENT.md', reason: 'name-mismatch' }]);
  });

  it('flags a forbidden key but keeps the agent', async () => {
    await writeAgent(workspaceRoot, 'alpha', { extraFrontmatter: 'model: claude-opus' });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents.map(({ name }) => name)).toEqual(['alpha']);
    expect(result.issues).toEqual([
      { path: 'alpha/AGENT.md', reason: 'forbidden-field', detail: 'model' },
    ]);
  });

  it('flags an unknown key but keeps the agent', async () => {
    await writeAgent(workspaceRoot, 'alpha', { extraFrontmatter: 'notes: hello' });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents.map(({ name }) => name)).toEqual(['alpha']);
    expect(result.issues).toEqual([
      { path: 'alpha/AGENT.md', reason: 'unknown-field', detail: 'notes' },
    ]);
  });

  it('reports an AGENT.md above the reader cap', async () => {
    await writeAgent(workspaceRoot, 'alpha', { body: 'a'.repeat(33 * KIB) });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents).toEqual([]);
    expect(result.issues).toEqual([
      { path: 'alpha/AGENT.md', reason: 'too-large', detail: 'AGENT.md' },
    ]);
  });

  it('reports a body above the shared system prompt cap', async () => {
    await writeAgent(workspaceRoot, 'alpha', { body: 'a'.repeat(25 * KIB) });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents).toEqual([]);
    expect(result.issues).toEqual([
      { path: 'alpha/AGENT.md', reason: 'too-large', detail: 'systemPrompt' },
    ]);
  });

  it('rejects a name that fails shared validation', async () => {
    await writeAgent(workspaceRoot, 'Bad_Name');

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents).toEqual([]);
    expect(result.issues).toEqual([{ path: 'Bad_Name/AGENT.md', reason: 'invalid-name' }]);
  });

  it('is deterministic regardless of directory creation order', async () => {
    const forward = join(tmp, 'forward');
    const reverse = join(tmp, 'reverse');
    await mkdir(forward, { recursive: true });
    await mkdir(reverse, { recursive: true });

    const names = ['alpha', 'beta', 'gamma'];
    for (const name of names) await writeAgent(forward, name);
    for (const name of [...names].reverse()) await writeAgent(reverse, name);

    const forwardResult = await loadCustomAgentSource({
      scope: 'workspace',
      workspaceRoot: forward,
    });
    const reverseResult = await loadCustomAgentSource({
      scope: 'workspace',
      workspaceRoot: reverse,
    });

    expect(JSON.stringify(reverseResult)).toBe(JSON.stringify(forwardResult));
    expect(reverseResult.agents.map(({ name }) => name)).toEqual(names);
  });

  it('reports a directory without AGENT.md as missing frontmatter', async () => {
    await mkdir(join(workspaceRoot, '.chatroom', 'agents', 'alpha'), { recursive: true });

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });

    expect(result.agents).toEqual([]);
    expect(result.issues).toEqual([{ path: 'alpha/AGENT.md', reason: 'missing-frontmatter' }]);
  });

  it('never puts an absolute path or the home directory in an issue', async () => {
    await writeAgent(workspaceRoot, 'alpha', { extraFrontmatter: 'model: claude-opus' });
    await writeAgent(workspaceRoot, 'Bad_Name');
    await writeAgent(workspaceRoot, 'beta', { name: 'gamma' });
    await mkdir(join(workspaceRoot, '.chatroom', 'agents', 'empty-entry'));
    await writeFile(join(workspaceRoot, '.chatroom', 'agents', 'stray-file.md'), 'not a directory');

    const result = await loadCustomAgentSource({ scope: 'workspace', workspaceRoot });
    const serialized = JSON.stringify(result.issues);

    expect(result.issues.length).toBeGreaterThan(0);
    expect(serialized).not.toContain(workspaceRoot);
    expect(serialized).not.toContain(tmp);
    expect(serialized).not.toContain(tmpdir());
    for (const issue of result.issues) {
      expect(issue.path.startsWith('/')).toBe(false);
      // Only errno codes and file names are allowed; never a prose Error message.
      expect(issue.detail ?? '').not.toMatch(/Error|: /);
    }
  });
});
