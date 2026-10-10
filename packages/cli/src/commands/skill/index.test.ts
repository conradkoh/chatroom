/**
 * skill command Unit Tests
 *
 * Tests the skill commands using injected dependencies.
 * Does NOT make real network calls — all backend ops are mocked.
 */

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

/** Builtin registry as returned by api.skills.list. */
const builtinBacklogList = [
  { skillId: 'backlog', name: 'Backlog', description: 'Manage backlog items', type: 'builtin' },
];

/** Build a discovered external skill. Paths are fake; nothing touches the real filesystem. */
function externalSkill(skillId: string, overrides: { description?: string; body?: string } = {}) {
  const dir = `/home/user/.agents/skills/${skillId}`;
  return {
    skillId,
    name: skillId,
    description: overrides.description ?? `${skillId} description`,
    skillDir: dir,
    sourcePath: dir,
    body: overrides.body ?? `# ${skillId}\n`,
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
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(builtinBacklogList);
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

  it('exits with code 1 and says not found when the id is neither builtin nor installed', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(builtinBacklogList);

    await activateSkill(TEST_CHATROOM_ID, 'bad-skill', { role: 'builder' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('not found');
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('exits with code 1 when mutation throws a generic error', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(builtinBacklogList);
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
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(builtinBacklogList);
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

describe('activateSkill — machine-installed skills', () => {
  it('prints the directory and body of an installed skill and makes no mutation call', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(builtinBacklogList);
    mockDiscovery(deps, [
      externalSkill('agent-browser', { body: '# agent-browser\n\nUse the browser.\n' }),
    ]);

    await activateSkill(TEST_CHATROOM_ID, 'agent-browser', { role: 'builder' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.mutation).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('✅ Skill "agent-browser" activated (installed on this machine).');
    expect(output).toContain('Skill directory: /home/user/.agents/skills/agent-browser');
    expect(output).toContain('# agent-browser');
    expect(output).toContain('Use the browser.');
  });

  it('calls the mutation for a builtin id even when an installed skill has the same name', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(builtinBacklogList);
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      skill: { skillId: 'backlog', prompt: 'Builtin prompt.' },
    });
    mockDiscovery(deps, [externalSkill('backlog', { body: 'External body.' })]);

    await activateSkill(TEST_CHATROOM_ID, 'backlog', { role: 'builder' }, deps);

    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    const output = getAllLogOutput();
    expect(output).toContain('Builtin prompt.');
    expect(output).not.toContain('External body.');
  });

  it('strips control characters from the installed skill body', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockDiscovery(deps, [
      externalSkill('evil-skill', { body: 'Plain\u001b[31m RED\u001b[0m\u0007 line\n' }),
    ]);

    await activateSkill(TEST_CHATROOM_ID, 'evil-skill', { role: 'builder' }, deps);

    const output = getAllLogOutput();
    expect(output).toContain('Plain RED line');
    expect(output).not.toMatch(/\u001b|\u0007/);
  });

  it('points to chatroom skill list when the id is neither builtin nor installed', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(builtinBacklogList);

    await activateSkill(TEST_CHATROOM_ID, 'does-not-exist', { role: 'builder' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain(
      `❌ Skill "does-not-exist" not found. Run \`chatroom skill list --chatroom-id=${TEST_CHATROOM_ID} --role=builder\` to see available skills.`
    );
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });
});

describe('bidi controls in installed skill output', () => {
  it('strips bidi controls from both skill list and skill activate output', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockDiscovery(deps, [
      externalSkill('spoof', { description: 'Safe\u202E desc', body: 'Body\u2066 text\n' }),
    ]);
    const bidi = /[\u202A-\u202E\u2066-\u2069]/;

    await listSkills(TEST_CHATROOM_ID, { role: 'builder' }, deps);
    const listOutput = getAllLogOutput();
    expect(listOutput).toContain('Safe desc');
    expect(listOutput).not.toMatch(bidi);

    logSpy.mockClear();
    await activateSkill(TEST_CHATROOM_ID, 'spoof', { role: 'builder' }, deps);
    const activateOutput = getAllLogOutput();
    expect(activateOutput).toContain('Body text');
    expect(activateOutput).not.toMatch(bidi);
  });
});

describe('carriage returns in installed skill output', () => {
  it('turns a CR in the activation body into a newline, so it cannot overwrite a printed line', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    mockDiscovery(deps, [externalSkill('crafty', { body: 'line1\rSPOOF' })]);

    await activateSkill(TEST_CHATROOM_ID, 'crafty', { role: 'builder' }, deps);

    const output = getAllLogOutput();
    expect(output).toContain('line1\nSPOOF');
    expect(output).not.toContain('\r');
  });
});
