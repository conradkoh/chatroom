/**
 * discoverExternalSkills — filesystem tests.
 *
 * Every test runs against a fresh mkdtemp directory and passes explicit roots,
 * so the real $HOME is never read.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  MAX_ENTRIES_PER_ROOT,
  MAX_SKILL_FILE_BYTES,
  discoverExternalSkills,
  getExternalSkillRoots,
} from './discover-external-skills.js';
import type { ExternalSkillRoot } from './types.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ext-skills-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function skillContent(name: string, description = `Description of ${name}`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nBody.\n`;
}

/** Create `<root>/<entry>/SKILL.md` with the given frontmatter name. */
async function writeSkill(root: string, entry: string, name = entry): Promise<string> {
  const dir = join(root, entry);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), skillContent(name));
  return dir;
}

function rootAt(path: string): ExternalSkillRoot {
  return { path };
}

// ─── Happy path and identity ────────────────────────────────────────────────

describe('discoverExternalSkills — identity and paths', () => {
  test('valid skill is discovered with skillDir set to the realpath', async () => {
    const root = join(testDir, 'root');
    await writeSkill(root, 'alpha');

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.issues).toEqual([]);
    expect(result.skills).toHaveLength(1);
    const [skill] = result.skills;
    expect(skill).toMatchObject({
      skillId: 'alpha',
      name: 'alpha',
      description: 'Description of alpha',
      sourcePath: join(root, 'alpha'),
      skillDir: await realpath(join(root, 'alpha')),
    });
    expect(skill?.body).toBe('# alpha\n\nBody.\n');
  });

  test('symlinked skill directory is followed: skillDir is the target, sourcePath is the link', async () => {
    const root = join(testDir, 'root');
    const store = join(testDir, 'store');
    await mkdir(root, { recursive: true });
    const target = await writeSkill(store, 'beta');
    await symlink(target, join(root, 'beta'));

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.issues).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      skillId: 'beta',
      sourcePath: join(root, 'beta'),
      skillDir: await realpath(target),
    });
  });

  test('same realpath reachable via two roots is de-duplicated with zero issues', async () => {
    const rootA = join(testDir, 'rootA');
    const rootB = join(testDir, 'rootB');
    const store = join(testDir, 'store');
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    const target = await writeSkill(store, 'gamma');
    await symlink(target, join(rootA, 'gamma'));
    await symlink(target, join(rootB, 'gamma'));

    const result = await discoverExternalSkills({ roots: [rootAt(rootA), rootAt(rootB)] });

    expect(result.issues).toEqual([]);
    expect(result.skills.map((s) => s.sourcePath)).toEqual([join(rootA, 'gamma')]);
  });

  test('same id at different realpaths: first root wins and one shadowed issue points at the winner', async () => {
    const rootA = join(testDir, 'rootA');
    const rootB = join(testDir, 'rootB');
    await writeSkill(rootA, 'delta');
    await writeSkill(rootB, 'delta');

    const result = await discoverExternalSkills({ roots: [rootAt(rootA), rootAt(rootB)] });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.sourcePath).toBe(join(rootA, 'delta'));
    expect(result.issues).toEqual([
      { path: join(rootB, 'delta'), reason: 'shadowed', detail: join(rootA, 'delta') },
    ]);
  });

  test('dot-directory (.system) is skipped silently', async () => {
    const root = join(testDir, 'root');
    await writeSkill(root, '.system', 'system');

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result).toEqual({ skills: [], issues: [] });
  });

  test('directory without SKILL.md (synced/ layout) is ignored silently', async () => {
    const root = join(testDir, 'root');
    await writeSkill(join(root, 'synced'), 'inner', 'inner');

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result).toEqual({ skills: [], issues: [] });
  });
});

// ─── Error and limit handling ───────────────────────────────────────────────

describe('discoverExternalSkills — per-entry issues', () => {
  test('dangling symlink is reported as unreadable', async () => {
    const root = join(testDir, 'root');
    await mkdir(root, { recursive: true });
    await symlink(join(testDir, 'nowhere'), join(root, 'dangling'));

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ path: join(root, 'dangling'), reason: 'unreadable' });
  });

  test('self-referential symlink loop is reported as unreadable and does not hang', async () => {
    const root = join(testDir, 'root');
    await mkdir(root, { recursive: true });
    await symlink('loop', join(root, 'loop'));

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ path: join(root, 'loop'), reason: 'unreadable' });
  });

  test('SKILL.md larger than MAX_SKILL_FILE_BYTES is too-large and the skill is absent', async () => {
    const root = join(testDir, 'root');
    const dir = join(root, 'huge');
    await mkdir(dir, { recursive: true });
    const padding = 'x'.repeat(MAX_SKILL_FILE_BYTES);
    await writeFile(join(dir, 'SKILL.md'), `---\nname: huge\ndescription: d\n---\n${padding}`);

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ path: dir, reason: 'too-large' });
  });

  test('frontmatter name differing from directory name is name-mismatch', async () => {
    const root = join(testDir, 'root');
    await writeSkill(root, 'epsilon', 'other-name');

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      path: join(root, 'epsilon'),
      reason: 'name-mismatch',
    });
  });
});

describe('discoverExternalSkills — roots', () => {
  test('missing root is silent', async () => {
    const result = await discoverExternalSkills({
      roots: [rootAt(join(testDir, 'does-not-exist'))],
    });

    expect(result).toEqual({ skills: [], issues: [] });
  });

  test('root path that is a regular file is silent (ENOTDIR)', async () => {
    const filePath = join(testDir, 'not-a-dir');
    await writeFile(filePath, 'plain file');

    const result = await discoverExternalSkills({ roots: [rootAt(filePath)] });

    expect(result).toEqual({ skills: [], issues: [] });
  });

  test('root-truncated: extra entries are dropped with exactly one issue', async () => {
    const root = join(testDir, 'root');
    await writeSkill(root, 'a-one');
    await writeSkill(root, 'b-two');
    await writeSkill(root, 'c-three');

    const result = await discoverExternalSkills({ roots: [rootAt(root)], maxEntriesPerRoot: 2 });

    expect(result.skills.map((s) => s.skillId)).toEqual(['a-one', 'b-two']);
    expect(result.issues).toEqual([{ path: root, reason: 'root-truncated', detail: '3' }]);
  });

  test('output is sorted by skillId regardless of creation order', async () => {
    const root = join(testDir, 'root');
    await writeSkill(root, 'zeta');
    await writeSkill(root, 'alpha');
    await writeSkill(root, 'mid');

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    const ids = result.skills.map((s) => s.skillId);
    expect(ids).toEqual(['alpha', 'mid', 'zeta']);
    expect(ids).toEqual([...ids].sort());
  });

  test('default cap constant is 200 entries per root', () => {
    expect(MAX_ENTRIES_PER_ROOT).toBe(200);
  });
});

// ─── Root list ──────────────────────────────────────────────────────────────

describe('getExternalSkillRoots', () => {
  test('returns the 10 roots under homeDir in the documented precedence order', () => {
    const homeDir = join(testDir, 'fake-home');

    const roots = getExternalSkillRoots(homeDir).map((r) => r.path);

    expect(roots).toEqual([
      join(homeDir, '.agents', 'skills'),
      join(homeDir, '.config', 'agents', 'skills'),
      join(homeDir, '.claude', 'skills'),
      join(homeDir, '.codex', 'skills'),
      join(homeDir, '.config', 'opencode', 'skills'),
      join(homeDir, '.config', 'opencode', 'skill'),
      join(homeDir, '.cursor', 'skills'),
      join(homeDir, '.gemini', 'skills'),
      join(homeDir, '.copilot', 'skills'),
      join(homeDir, '.pi', 'agent', 'skills'),
    ]);
  });
});
