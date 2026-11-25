/**
 * grounding read — Unit Tests
 *
 * Drives the command with an injected Convex query port so the header output and
 * error mapping run for real.
 */

import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { readGrounding, type GroundingDetail } from './read';
import type { ConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';

const GROUNDING_CONTENT = [
  '# Grounding: ship the badge',
  '',
  '## Request',
  '- Ship the grounding badge (source: msg_1)',
].join('\n');

const GROUNDING_DETAIL: GroundingDetail = {
  groundingId: 'msg_1',
  senderRole: 'builder',
  createdAt: 1_700_000_000_000,
  content: GROUNDING_CONTENT,
};

function createMockDeps(detail: GroundingDetail | Error = GROUNDING_DETAIL): ConvexCommandDeps {
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

describe('readGrounding', () => {
  test('prints the header, the stored content and the verify line', async () => {
    const deps = createMockDeps();

    await readGrounding(TEST_CHATROOM_ID, { role: 'builder', groundingId: 'msg_1' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.query).toHaveBeenCalledTimes(1);
    expect(deps.backend.query).toHaveBeenCalledWith(expect.anything(), {
      sessionId: TEST_SESSION_ID,
      chatroomId: TEST_CHATROOM_ID,
      groundingId: 'msg_1',
    });

    const output = stdout();
    expect(output).toContain('Grounding ID: msg_1');
    expect(output).toContain('Author: builder');
    expect(output).toContain('Created: 2023-11-14T22:13:20.000Z');
    expect(output).toContain(GROUNDING_CONTENT);
    expect(output).toContain(
      'Preliminary observations: verify against the repository before relying on them.'
    );
  });

  test('reads a grounding without --role', async () => {
    const deps = createMockDeps();

    await readGrounding(TEST_CHATROOM_ID, { groundingId: 'msg_1' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdout()).toContain('Grounding ID: msg_1');
  });

  test('reports GROUNDING_NOT_FOUND from the backend', async () => {
    const deps = createMockDeps(
      new ConvexError({ code: 'GROUNDING_NOT_FOUND', message: 'Grounding not found: bad' })
    );

    await readGrounding(TEST_CHATROOM_ID, { role: 'builder', groundingId: 'bad' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Grounding not found: bad');
    expect(stderr()).toContain('Check the grounding id reported by the author.');
  });

  test('exits 1 when there is no session', async () => {
    const deps = createMockDeps();
    deps.session = {
      getSessionId: vi.fn().mockResolvedValue(null),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    };

    await readGrounding(TEST_CHATROOM_ID, { role: 'builder', groundingId: 'msg_1' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderr()).toContain('Not authenticated');
    expect(deps.backend.query).not.toHaveBeenCalled();
  });
});
