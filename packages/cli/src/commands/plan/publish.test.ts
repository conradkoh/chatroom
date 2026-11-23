/**
 * plan publish — Unit Tests
 *
 * Drives the command with injected backend/session deps so the Effect pipeline,
 * pre-validation and error mapping run for real; only the Convex ports and the
 * process/console sinks are substituted.
 */

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { publishPlan } from './publish.js';
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

function createMockDeps(overrides?: Partial<ConvexCommandDeps>): ConvexCommandDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({
        messageId: 'msg_1',
        planId: 'plan_1',
        phaseIds: ['P1', 'P2'],
      }),
      query: vi.fn().mockResolvedValue(null),
    },
    session: {
      getSessionId: vi.fn().mockResolvedValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
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

describe('publishPlan', () => {
  test('publishes a valid plan and reports the plan id and phases', async () => {
    const deps = createMockDeps();

    await publishPlan(TEST_CHATROOM_ID, { role: 'specifier', content: VALID_PLAN }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    expect(deps.backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: TEST_SESSION_ID,
      chatroomId: TEST_CHATROOM_ID,
      senderRole: 'specifier',
      content: VALID_PLAN,
    });

    const output = stdout();
    expect(output).toContain('✅ Plan published');
    expect(output).toContain('Plan ID: plan_1');
    expect(output).toContain('Phases: P1, P2');
    expect(output).toContain('Pass this plan ID');
  });

  test('forwards supersedesPlanId when superseding a plan', async () => {
    const deps = createMockDeps();

    await publishPlan(
      TEST_CHATROOM_ID,
      { role: 'specifier', content: VALID_PLAN, supersedesPlanId: 'plan_0' },
      deps
    );

    expect(deps.backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: TEST_SESSION_ID,
      chatroomId: TEST_CHATROOM_ID,
      senderRole: 'specifier',
      content: VALID_PLAN,
      supersedesPlanId: 'plan_0',
    });
  });

  test('rejects an invalid plan before writing anything', async () => {
    const deps = createMockDeps();
    const invalid = VALID_PLAN.split('\n')
      .filter((line) => line !== '## Constraints' && line !== '- None.')
      .join('\n');

    await publishPlan(TEST_CHATROOM_ID, { role: 'specifier', content: invalid }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toMatch(/line \d+: PLAN_SECTION_MISSING/);
    expect(stderr()).toContain('## Constraints');
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  test('reports backend INVALID_PLAN errors with line numbers', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConvexError({
        code: 'INVALID_PLAN',
        message: 'Plan does not match the plan template',
        errors: [
          {
            code: 'PLAN_PHASE_DETAIL_MISSING',
            line: 12,
            message: 'Missing "### P2 …" block',
          },
        ],
      })
    );

    await publishPlan(TEST_CHATROOM_ID, { role: 'specifier', content: VALID_PLAN }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('line 12: PLAN_PHASE_DETAIL_MISSING');
  });

  test('explains NO_ACTIVE_TASK failures', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConvexError({ code: 'NO_ACTIVE_TASK', message: 'No active task' })
    );

    await publishPlan(TEST_CHATROOM_ID, { role: 'specifier', content: VALID_PLAN }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('only works while you are working on a task');
  });

  test('exits 1 when there is no session', async () => {
    const deps = createMockDeps({
      session: {
        getSessionId: vi.fn().mockResolvedValue(null),
        getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
        getOtherSessionUrls: vi.fn().mockResolvedValue([]),
      },
    });

    await publishPlan(TEST_CHATROOM_ID, { role: 'specifier', content: VALID_PLAN }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Not authenticated');
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });
});
