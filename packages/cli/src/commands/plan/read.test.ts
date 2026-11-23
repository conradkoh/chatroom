/**
 * plan read — Unit Tests
 *
 * Drives the command with an injected Convex query port so the phase
 * projection, header output and error mapping run for real.
 */

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { readPlan, type PlanDetail } from './read.js';
import type { ConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

const VALID_PLAN = [
  '# Test plan',
  '',
  '## Sources',
  '- user-request-1',
  '',
  '## Requirements',
  '- Ship the feature.',
  '',
  '## Constraints',
  '- None.',
  '',
  '## Phases',
  '- P1 — First',
  '- P2 — Second',
  '',
  '## Phase details',
  '',
  '### P1 — First',
  '',
  '#### Requirements',
  '- P1 requirement.',
  '',
  '#### Constraints',
  '- None.',
  '',
  '#### Acceptance criteria',
  '- P1 acceptance.',
  '',
  '### P2 — Second',
  '',
  '#### Depends on',
  '- P1',
  '',
  '#### Requirements',
  '- P2 requirement.',
  '',
  '#### Constraints',
  '- None.',
  '',
  '#### Acceptance criteria',
  '- P2 acceptance.',
].join('\n');

const PLAN_DETAIL: PlanDetail = {
  planId: 'plan_1',
  senderRole: 'specifier',
  createdAt: 1_700_000_000_000,
  content: VALID_PLAN,
  supersedes: null,
  supersededBy: null,
};

function createMockDeps(detail: PlanDetail | Error = PLAN_DETAIL): ConvexCommandDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(null),
      query:
        detail instanceof Error
          ? vi.fn().mockRejectedValue(detail)
          : vi.fn().mockResolvedValue({ ...detail }),
    },
    session: {
      getSessionId: vi.fn().mockResolvedValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    },
  };
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function stdout(): string {
  return logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
}

function stderr(): string {
  return errorSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
}

describe('readPlan', () => {
  test('prints the header and the exact stored content', async () => {
    const deps = createMockDeps();

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'plan_1' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.query).toHaveBeenCalledTimes(1);
    expect(deps.backend.query).toHaveBeenCalledWith(expect.anything(), {
      sessionId: TEST_SESSION_ID,
      chatroomId: TEST_CHATROOM_ID,
      planId: 'plan_1',
    });

    const output = stdout();
    expect(output).toContain('Plan ID: plan_1');
    expect(output).toContain('Author: specifier');
    expect(output).toContain('Created: 2023-11-14T22:13:20.000Z');
    expect(output).toContain(VALID_PLAN);
  });

  test('reads a plan without --role', async () => {
    const deps = createMockDeps();

    await readPlan(TEST_CHATROOM_ID, { planId: 'plan_1' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = stdout();
    expect(output).toContain('Plan ID: plan_1');
    expect(output).toContain('Author: specifier');
    expect(output).toContain(VALID_PLAN);
  });

  test('reports supersede links when present', async () => {
    const deps = createMockDeps({ ...PLAN_DETAIL, supersedes: 'plan_0', supersededBy: 'plan_2' });

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'plan_1' }, deps);

    const output = stdout();
    expect(output).toContain('Supersedes: plan_0');
    expect(output).toContain('⚠ Superseded by plan_2');
  });

  test('projects one phase with --phase', async () => {
    const deps = createMockDeps();

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'plan_1', phase: 'P2' }, deps);

    const output = stdout();
    expect(output).toContain('### P2 — Second');
    expect(output).toContain('- **P2 — Second** (selected phase)');
    expect(output).toContain('#### Depends on');
    expect(output).toContain('- P1');
    expect(output).not.toContain('### P1 — First');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('normalises a lowercase phase id', async () => {
    const deps = createMockDeps();

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'plan_1', phase: 'p2' }, deps);

    expect(stdout()).toContain('- **P2 — Second** (selected phase)');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('exits 1 and lists available phases when the phase is absent', async () => {
    const deps = createMockDeps();

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'plan_1', phase: 'P9' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Phase not found: P9');
    expect(stderr()).toContain('Available phases: P1, P2');
  });

  test('reports PLAN_NOT_FOUND from the backend', async () => {
    const deps = createMockDeps(
      new ConvexError({ code: 'PLAN_NOT_FOUND', message: 'Plan not found: bad' })
    );

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'bad' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Plan not found: bad');
  });

  test('shows the raw content when a stored plan cannot be parsed for a phase', async () => {
    const deps = createMockDeps({ ...PLAN_DETAIL, content: 'not a plan' });

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'plan_1', phase: 'P1' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('does not match the current template');
    expect(stderr()).toContain('not a plan');
  });

  test('exits 1 when there is no session', async () => {
    const deps = createMockDeps();
    deps.session = {
      getSessionId: vi.fn().mockResolvedValue(null),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    };

    await readPlan(TEST_CHATROOM_ID, { role: 'specifier', planId: 'plan_1' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Not authenticated');
    expect(deps.backend.query).not.toHaveBeenCalled();
  });
});
