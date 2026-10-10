/**
 * skill command Unit Tests
 *
 * Tests the skill commands using injected dependencies.
 * Does NOT make real network calls — all backend ops are mocked.
 */

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillDeps } from './deps.js';
import { activateSkill, listSkills } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

function createMockDeps(overrides?: Partial<SkillDeps>): SkillDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([]),
    },
    session: {
      getSessionId: vi.fn().mockResolvedValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    },
    externalSkills: {
      discover: vi.fn().mockResolvedValue({ skills: [], issues: [] }),
    },
    ...overrides,
  };
}

/** Build a discovered external skill. Paths are fake; nothing touches the real filesystem. */
function externalSkill(skillId: string, overrides: { description?: string } = {}) {
  const dir = `/home/user/.agents/skills/${skillId}`;
  return {
    skillId,
    name: skillId,
    description: overrides.description ?? `${skillId} description`,
    skillDir: dir,
    sourcePath: dir,
    body: `# ${skillId}\n`,
  };
}

function mockDiscovery(deps: SkillDeps, skills: unknown[], issues: unknown[] = []): void {
  (deps.externalSkills.discover as ReturnType<typeof vi.fn>).mockResolvedValue({ skills, issues });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;
let logSpy: any;
let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// listSkills tests
// ---------------------------------------------------------------------------

describe('listSkills', () => {
  it('exits with code 1 when not authenticated', async () => {
    const deps = createMockDeps({
      session: {
        getSessionId: vi.fn().mockResolvedValue(null),
        getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
        getOtherSessionUrls: vi.fn().mockResolvedValue([]),
      },
    });

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Not authenticated');
  });

  it('prints "No skills available." when the query returns empty array', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getAllLogOutput()).toContain('No skills available.');
  });

  it('prints aligned skill list when skills are returned', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        skillId: 'backlog',
        name: 'Score Backlog',
        description: 'Score all unscored backlog items by complexity, value, and priority.',
        type: 'builtin',
      },
    ]);

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('backlog');
    expect(output).toContain(
      'Score all unscored backlog items by complexity, value, and priority.'
    );
    expect(output).toContain('Available skills:');
  });

  it('exits with code 1 when query throws a generic error', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Network error');
  });
});

describe('listSkills — machine-installed skills', () => {
  const builtinBrowser = {
    skillId: 'agent-browser',
    name: 'Builtin Browser',
    description: 'Builtin browser description',
    type: 'builtin',
  };

  it('lists installed skills with their skill directory', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { skillId: 'backlog', name: 'Backlog', description: 'Manage backlog', type: 'builtin' },
    ]);
    mockDiscovery(deps, [externalSkill('agent-browser', { description: 'Drive a browser' })]);

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('Available skills:');
    expect(output).toContain('Installed skills (this machine):');
    expect(output).toContain('agent-browser');
    expect(output).toContain('Drive a browser');
    expect(output).toContain('/home/user/.agents/skills/agent-browser');
  });

  it('hides an installed skill that collides with a builtin and reports it as skipped', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([builtinBrowser]);
    mockDiscovery(deps, [externalSkill('agent-browser', { description: 'External browser' })]);

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    const output = getAllLogOutput();
    expect(output).toContain('Builtin browser description');
    expect(output).not.toContain('External browser');
    expect(output).not.toContain('Installed skills (this machine):');
    expect(output).toContain('Skipped installed skills:');
    expect(output).toContain('builtin-collision');
  });

  it('lists installed skills without printing "No skills available." when there are no builtins', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockDiscovery(deps, [externalSkill('local-tool')]);

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    const output = getAllLogOutput();
    expect(output).toContain('local-tool');
    expect(output).toContain('Installed skills (this machine):');
    expect(output).not.toContain('No skills available.');
    expect(output).not.toContain('Available skills:');
  });

  it('strips control characters from installed skill fields', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockDiscovery(deps, [
      externalSkill('evil-skill', { description: 'Clean\u001b[31m RED\u001b[0m\u0007 text' }),
    ]);

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);

    const output = getAllLogOutput();
    expect(output).toContain('Clean RED text');
    expect(output).not.toMatch(/\u001b|\u0007/);
  });
});

// ---------------------------------------------------------------------------
// activateSkill tests
// ---------------------------------------------------------------------------

describe('activateSkill', () => {
  it('exits with code 1 when not authenticated', async () => {
    const deps = createMockDeps({
      session: {
        getSessionId: vi.fn().mockResolvedValue(null),
        getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
        getOtherSessionUrls: vi.fn().mockResolvedValue([]),
      },
    });

    await activateSkill(TEST_CHATROOM_ID, 'backlog', { role: 'builder' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Not authenticated');
  });

  it('prints success message when activation succeeds', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      skill: {
        skillId: 'backlog',
        name: 'Score Backlog',
        prompt: 'Score all unscored backlog items.',
      },
    });

    await activateSkill(TEST_CHATROOM_ID, 'backlog', { role: 'builder' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('✅ Skill "backlog" activated.');
    expect(output).toContain('Score all unscored backlog items.');
  });

  it('exits with code 1 and prints error message when skill not found (ConvexError)', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConvexError('Skill "bad-skill" not found or is disabled.')
    );

    await activateSkill(TEST_CHATROOM_ID, 'bad-skill', { role: 'builder' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = getAllErrorOutput();
    expect(errorOutput).toContain('not found or is disabled');
  });

  it('exits with code 1 when mutation throws a generic error', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused')
    );

    await activateSkill(TEST_CHATROOM_ID, 'backlog', { role: 'builder' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = getAllErrorOutput();
    expect(errorOutput).toContain('Connection refused');
  });

  it('calls mutation with the correct arguments', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      skill: {
        skillId: 'backlog',
        name: 'Score Backlog',
        prompt: 'Score all unscored backlog items.',
      },
    });

    await activateSkill(TEST_CHATROOM_ID, 'backlog', { role: 'planner' }, deps);

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(), // api.skills.activate
      expect.objectContaining({
        sessionId: TEST_SESSION_ID,
        chatroomId: TEST_CHATROOM_ID,
        skillId: 'backlog',
        role: 'planner',
        convexUrl: 'http://test:3210',
      })
    );
  });
});
