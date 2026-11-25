/**
 * grounding publish — Unit Tests
 *
 * Drives the command with injected backend/session deps so the Effect pipeline,
 * pre-validation and error mapping run for real; only the Convex ports and the
 * process/console sinks are substituted.
 */

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { publishGrounding } from './publish';
import type { ConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

const VALID_GROUNDING = [
  '# Grounding: ship the badge',
  '',
  '## Request',
  '- Ship the grounding badge (source: msg_1)',
  '',
  '## Relevant files',
  '- `apps/webapp/src/x.ts` — renders the badge',
  '',
  '## Entry points',
  '- `TimelineMessageTypeBadge` in `apps/webapp/src/y.tsx` — rendered by the timeline row',
  '',
  '## Flow',
  '```mermaid',
  'sequenceDiagram',
  '  user->>builder: request',
  '```',
  '',
  '## Prior records',
  '- None observed.',
  '',
  '## Not inspected',
  '- None observed.',
].join('\n');

const INVALID_GROUNDING = VALID_GROUNDING.split('\n')
  .filter((line) => line !== '## Not inspected')
  .join('\n');

function createMockDeps(overrides?: Partial<ConvexCommandDeps>): ConvexCommandDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({
        messageId: 'msg_1',
        groundingId: 'msg_1',
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

describe('publishGrounding', () => {
  test('publishes a valid grounding and reports the id', async () => {
    const deps = createMockDeps();

    await publishGrounding(TEST_CHATROOM_ID, { role: 'builder', content: VALID_GROUNDING }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    expect(deps.backend.mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: TEST_SESSION_ID,
      chatroomId: TEST_CHATROOM_ID,
      senderRole: 'builder',
      content: VALID_GROUNDING,
    });

    const output = stdout();
    expect(output).toContain('✅ Grounding published');
    expect(output).toContain('Grounding ID: msg_1');
    expect(output).toContain('## Grounding');
  });

  test('rejects an invalid grounding before writing anything', async () => {
    const deps = createMockDeps();

    await publishGrounding(TEST_CHATROOM_ID, { role: 'builder', content: INVALID_GROUNDING }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('❌ Grounding not published');
    expect(stderr()).toMatch(/line \d+: GROUNDING_SECTION_MISSING/);
    expect(stderr()).toContain('chatroom grounding view-template');
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  test('reports backend INVALID_GROUNDING errors with line numbers', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConvexError({
        code: 'INVALID_GROUNDING',
        message: 'Grounding does not match the grounding template',
        errors: [
          {
            code: 'GROUNDING_SECTION_ORDER',
            line: 4,
            message: 'Section "Flow" is out of order',
          },
        ],
      })
    );

    await publishGrounding(TEST_CHATROOM_ID, { role: 'builder', content: VALID_GROUNDING }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('line 4: GROUNDING_SECTION_ORDER');
    expect(stderr()).toContain('chatroom grounding view-template');
  });

  test('explains NO_ACTIVE_TASK failures', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConvexError({ code: 'NO_ACTIVE_TASK', message: 'No active task' })
    );

    await publishGrounding(TEST_CHATROOM_ID, { role: 'builder', content: VALID_GROUNDING }, deps);

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

    await publishGrounding(TEST_CHATROOM_ID, { role: 'builder', content: VALID_GROUNDING }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Not authenticated');
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });
});
