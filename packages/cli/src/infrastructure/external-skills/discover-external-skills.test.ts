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

import { discoverExternalSkills } from './discover-external-skills.js';
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

  test('dangling SKILL.md symlink is reported as unreadable with ENOENT', async () => {
    const root = join(testDir, 'root');
    const dir = join(root, 'c');
    await mkdir(dir, { recursive: true });
    await symlink(join(testDir, 'missing.md'), join(dir, 'SKILL.md'));

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills).toEqual([]);
    expect(result.issues).toEqual([{ path: dir, reason: 'unreadable', detail: 'ENOENT' }]);
  });

  test('self-referential SKILL.md symlink is reported as unreadable with ELOOP', async () => {
    const root = join(testDir, 'root');
    const dir = join(root, 'd');
    await mkdir(dir, { recursive: true });
    await symlink('SKILL.md', join(dir, 'SKILL.md'));

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills).toEqual([]);
    expect(result.issues).toEqual([{ path: dir, reason: 'unreadable', detail: 'ELOOP' }]);
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

  test('SKILL.md larger than the 64 KiB cap is too-large and the skill is absent', async () => {
    const root = join(testDir, 'root');
    const dir = join(root, 'huge');
    await mkdir(dir, { recursive: true });
    // 64 KiB of padding plus frontmatter: over the module's MAX_SKILL_FILE_BYTES cap.
    const padding = 'x'.repeat(64 * 1024);
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
});

// ─── Root list ──────────────────────────────────────────────────────────────

describe('discoverExternalSkills — root precedence', () => {
  test('scans all ten roots in precedence order', async () => {
    const homeDir = join(testDir, 'fake-home');
    const roots = [
      '.agents/skills',
      '.config/agents/skills',
      '.claude/skills',
      '.codex/skills',
      '.config/opencode/skills',
      '.config/opencode/skill',
      '.cursor/skills',
      '.gemini/skills',
      '.copilot/skills',
      '.pi/agent/skills',
    ];
    for (const root of roots) {
      const dir = join(homeDir, root, 'dup');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'SKILL.md'),
        '---\nname: dup\ndescription: Dup skill.\n---\nbody\n'
      );
    }

    const result = await discoverExternalSkills({ homeDir });

    expect(result.skills[0]?.sourcePath).toBe(join(homeDir, '.agents/skills/dup'));
    expect(result.issues.map((i) => i.path)).toEqual(
      roots.slice(1).map((r) => join(homeDir, r, 'dup'))
    );
    for (const issue of result.issues) expect(issue.reason).toBe('shadowed');
  });
});

describe('discoverExternalSkills — realpath claims', () => {
  test('a rejected alias that sorts first does not hide the real skill directory', async () => {
    const root = join(testDir, 'root');
    await writeSkill(root, 'b');
    await symlink('b', join(root, 'a'));

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills.map((s) => s.skillId)).toEqual(['b']);
    expect(result.skills[0]).toMatchObject({
      sourcePath: join(root, 'b'),
      skillDir: await realpath(join(root, 'b')),
    });
    expect(result.issues).toEqual([
      { path: join(root, 'a'), reason: 'name-mismatch', detail: 'name "b" ≠ directory "a"' },
    ]);
  });

  test('an accepted skill claims its realpath, so a later alias is de-duplicated silently', async () => {
    const root = join(testDir, 'root');
    await writeSkill(root, 'b');
    await symlink('b', join(root, 'z'));

    const result = await discoverExternalSkills({ roots: [rootAt(root)] });

    expect(result.skills.map((s) => s.skillId)).toEqual(['b']);
    expect(result.issues).toEqual([]);
  });

  test('a shadowed skill claims its realpath, so a later alias in the same root is de-duplicated silently', async () => {
    const root1 = join(testDir, 'root1');
    const root2 = join(testDir, 'root2');
    await writeSkill(root1, 'b');
    await writeSkill(root2, 'b');
    await symlink(join(root2, 'b'), join(root2, 'z'));

    const result = await discoverExternalSkills({ roots: [rootAt(root1), rootAt(root2)] });

    expect(result.skills.map((s) => s.sourcePath)).toEqual([join(root1, 'b')]);
    expect(result.issues).toEqual([
      { path: join(root2, 'b'), reason: 'shadowed', detail: join(root1, 'b') },
    ]);
  });
});
