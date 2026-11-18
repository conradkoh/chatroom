/**
 * Integrations Effect Pipeline Tests
 *
 * Tests the pure Effect pipeline (listIntegrationsEffect) using test layers that
 * substitute only the BackendService and SessionService ports.
 * process.exit behavior is not tested here (it belongs in boundary tests).
 */

import { getFunctionName } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { listIntegrationsEffect, type ListIntegrationsError } from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with a configurable query response. */
function makeTestBackend(config: { queryResponse?: unknown | Error | undefined }) {
  const query = vi.fn((_endpoint: any, _args: unknown) => {
    if (config.queryResponse instanceof Error) {
      return Effect.fail(config.queryResponse) as any;
    }
    return Effect.succeed(config.queryResponse) as any;
  });
  const mutation = vi.fn(() => Effect.fail(new Error('Mutation not used in integrations')) as any);
  const action = vi.fn(() => Effect.fail(new Error('Action not used in integrations')) as any);

  return {
    layer: Layer.succeed(BackendService, { query, mutation, action }),
    query,
    mutation,
  };
}

/** Create a test session service with configurable responses. */
function makeTestSession(config: {
  sessionId?: string | null | undefined;
  convexUrl?: string | undefined;
  otherUrls?: string[] | undefined;
}) {
  return Layer.succeed(SessionService, {
    getSessionId: () =>
      Effect.succeed(
        (config.sessionId !== undefined
          ? config.sessionId
          : 'test-session-id') as unknown as SessionId
      ),
    getConvexUrl: () => Effect.succeed(config.convexUrl ?? 'https://test.convex.cloud'),
    getOtherSessionUrls: () => Effect.succeed(config.otherUrls ?? []),
  });
}

/** Pull the typed domain error out of a runPromiseExit failure. */
function failureOf<E>(exit: any): E {
  const option = Cause.findErrorOption(exit.cause);
  if (option._tag !== 'Some') throw new Error('Expected a typed failure');
  return option.value as E;
}

/** Join every console.log call (arguments joined with spaces) into one searchable blob. */
function loggedOutput(): string {
  return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((call) => call.join(' '))
    .join('\n');
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const chatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';

const telegramNamed = {
  _id: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
  _creationTime: 1700000000000,
  chatroomId,
  platform: 'telegram',
  name: 'Ops alerts',
  description: 'Urgent only',
  config: {
    botToken: '••••••abcd',
    chatId: '-1001234',
    webhookUrl: 'https://hook.example/x',
    webhookSecret: 'shh-webhookSecret',
  },
  enabled: true,
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
};

const telegramUnnamed = {
  _id: 'b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6',
  _creationTime: 1700000002000,
  chatroomId,
  platform: 'telegram',
  config: {},
  enabled: false,
  createdAt: 1700000002000,
  updatedAt: 1700000002000,
};

const slackRow = {
  _id: 'c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6',
  _creationTime: 1700000003000,
  chatroomId,
  platform: 'slack',
  name: 'Slack alerts',
  description: 'Build results',
  config: { chatId: 'C123' },
  enabled: true,
  createdAt: 1700000003000,
  updatedAt: 1700000003000,
};

const allRows = [telegramNamed, telegramUnnamed, slackRow];

const expectedJson = [
  {
    integrationId: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
    platform: 'telegram',
    name: 'Ops alerts',
    description: 'Urgent only',
    enabled: true,
    chatId: '-1001234',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
  },
  {
    integrationId: 'b1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6',
    platform: 'telegram',
    name: null,
    description: null,
    enabled: false,
    chatId: null,
    createdAt: 1700000002000,
    updatedAt: 1700000002000,
  },
  {
    integrationId: 'c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6',
    platform: 'slack',
    name: 'Slack alerts',
    description: 'Build results',
    enabled: true,
    chatId: 'C123',
    createdAt: 1700000003000,
    updatedAt: 1700000003000,
  },
];

const expectedKeys = [
  'chatId',
  'createdAt',
  'description',
  'enabled',
  'integrationId',
  'name',
  'platform',
  'updatedAt',
];

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('listIntegrationsEffect', () => {
  const originalLog = console.log;
  beforeEach(() => {
    console.log = vi.fn();
  });
  afterEach(() => {
    console.log = originalLog;
  });

  function run(
    queryResponse: unknown | Error | undefined,
    options: { platform?: string; format?: 'text' | 'json' } = {},
    session: { sessionId?: string | null | undefined } = {}
  ) {
    const backend = makeTestBackend({ queryResponse });
    const layer = Layer.mergeAll(backend.layer, makeTestSession(session));
    return {
      backend,
      exit: Effect.runPromiseExit(
        listIntegrationsEffect({
          chatroomId,
          platform: options.platform,
          format: options.format ?? 'text',
        }).pipe(Effect.provide(layer))
      ),
    };
  }

  test('queries api.integrations.list once with the session and chatroom', async () => {
    const { backend, exit } = run(allRows);

    expect(await exit).toMatchObject({ _tag: 'Success' });
    expect(backend.query).toHaveBeenCalledTimes(1);
    // Convex's anyApi returns a fresh proxy per access, so compare the resolved name.
    expect(getFunctionName(backend.query.mock.calls[0][0])).toBe('integrations:list');
    expect(backend.query.mock.calls[0][1]).toEqual({
      sessionId: 'test-session-id',
      chatroomId,
    });
  });

  test('prints ids, name, description, status and chat id, and never prints secrets', async () => {
    const { exit } = run(allRows);
    expect(await exit).toMatchObject({ _tag: 'Success' });

    const output = loggedOutput();
    expect(output).toContain(telegramNamed._id);
    expect(output).toContain(telegramUnnamed._id);
    expect(output).toContain(slackRow._id);
    expect(output).toContain('Ops alerts');
    expect(output).toContain('Urgent only');
    expect(output).toContain('(unnamed)');
    expect(output).toContain('(none)');
    expect(output).toContain('enabled');
    expect(output).toContain('disabled');
    expect(output).toContain('-1001234');
    expect(output).toContain('(not set)');
    expect(output).toContain('chatroom telegram send-message');

    expect(output).not.toContain('abcd');
    expect(output).not.toContain('••');
    expect(output).not.toContain('hook.example');
    expect(output).not.toContain('webhookSecret');
  });

  test('json mode emits exactly the projection and nothing else', async () => {
    const { exit } = run(allRows, { format: 'json' });
    expect(await exit).toMatchObject({ _tag: 'Success' });

    expect(console.log).toHaveBeenCalledTimes(1);
    const raw = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ integrations: expectedJson });

    for (const entry of parsed.integrations) {
      expect(Object.keys(entry).sort()).toEqual(expectedKeys);
    }

    expect(raw).not.toContain('abcd');
    expect(raw).not.toContain('hook.example');
    expect(raw).not.toContain('webhookSecret');
  });

  test('filters by platform case-insensitively in text mode', async () => {
    const { exit } = run(allRows, { platform: 'Telegram' });
    expect(await exit).toMatchObject({ _tag: 'Success' });

    const output = loggedOutput();
    expect(output).toContain(telegramNamed._id);
    expect(output).toContain(telegramUnnamed._id);
    expect(output).not.toContain(slackRow._id);
    expect(output).not.toContain('Slack alerts');
  });

  test('filters by platform case-insensitively in json mode', async () => {
    const { exit } = run(allRows, { platform: 'Telegram', format: 'json' });
    expect(await exit).toMatchObject({ _tag: 'Success' });

    expect(console.log).toHaveBeenCalledTimes(1);
    const raw = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(JSON.parse(raw)).toEqual({ integrations: expectedJson.slice(0, 2) });
  });

  test('empty list prints guidance and exits successfully', async () => {
    const { exit } = run([]);
    expect(await exit).toMatchObject({ _tag: 'Success' });

    const output = loggedOutput();
    expect(output).toContain(`No integrations found for chatroom ${chatroomId}.`);
    expect(output).toContain('Integrations are set up in the web app');
  });

  test('empty platform-filtered list names the platform', async () => {
    const { exit } = run([], { platform: 'telegram' });
    expect(await exit).toMatchObject({ _tag: 'Success' });

    const output = loggedOutput();
    expect(output).toContain(`No telegram integrations found for chatroom ${chatroomId}.`);
    expect(output).toContain('Integrations are set up in the web app');
  });

  test('empty json list is an empty integrations array', async () => {
    const { exit } = run([], { format: 'json' });
    expect(await exit).toMatchObject({ _tag: 'Success' });

    expect(console.log).toHaveBeenCalledTimes(1);
    const raw = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(JSON.parse(raw)).toEqual({ integrations: [] });
  });

  test('control characters in a name cannot break the Name line', async () => {
    const evilRow = {
      ...telegramNamed,
      _id: 'd1e2f3g4h5i6j7k8l9m0n1o2p3q4r5s6',
      name: 'Ops\u001b[31m\nX',
    };
    const { exit } = run([evilRow]);
    expect(await exit).toMatchObject({ _tag: 'Success' });

    const nameLine = loggedOutput()
      .split('\n')
      .find((line) => line.trimStart().startsWith('Name:'));
    expect(nameLine).toBeDefined();
    expect(nameLine).toContain('Ops');
    expect(nameLine).toContain('X');
    expect(nameLine).not.toContain('\u001b');
  });

  test('fails with QueryFailed when the backend query fails', async () => {
    const { exit } = run(new Error('Network error'));

    const result = await exit;
    expect(result._tag).toBe('Failure');
    const error = failureOf<ListIntegrationsError>(result);
    expect(error._tag).toBe('QueryFailed');
    if (error._tag === 'QueryFailed') {
      expect(error.cause.message).toBe('Network error');
    }
  });

  test('fails with InvalidChatroomId before querying the backend', async () => {
    const backend = makeTestBackend({ queryResponse: allRows });
    const layer = Layer.mergeAll(backend.layer, makeTestSession({}));

    const exit = await Effect.runPromiseExit(
      listIntegrationsEffect({ chatroomId: 'abc', format: 'text' }).pipe(Effect.provide(layer))
    );

    expect(exit._tag).toBe('Failure');
    const error = failureOf<ListIntegrationsError>(exit);
    expect(error._tag).toBe('InvalidChatroomId');
    if (error._tag === 'InvalidChatroomId') {
      expect(error.id).toBe('abc');
    }
    expect(backend.query).not.toHaveBeenCalled();
  });

  test('fails with NotAuthenticated when there is no session', async () => {
    const backend = makeTestBackend({ queryResponse: allRows });
    const layer = Layer.mergeAll(
      backend.layer,
      makeTestSession({
        sessionId: null,
        convexUrl: 'https://test.convex.cloud',
        otherUrls: ['https://prod.convex.cloud'],
      })
    );

    const exit = await Effect.runPromiseExit(
      listIntegrationsEffect({ chatroomId, format: 'text' }).pipe(Effect.provide(layer))
    );

    expect(exit._tag).toBe('Failure');
    const error = failureOf<ListIntegrationsError>(exit);
    expect(error._tag).toBe('NotAuthenticated');
    if (error._tag === 'NotAuthenticated') {
      expect(error.convexUrl).toBe('https://test.convex.cloud');
      expect(error.otherUrls).toEqual(['https://prod.convex.cloud']);
    }
    expect(backend.query).not.toHaveBeenCalled();
  });
});
