import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';

import type { SDKMessage as ClaudeMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ThreadEvent } from '@openai/codex-sdk';
import type { SDKMessage as CursorMessage } from '@cursor/sdk';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeSdkStreamAdapter } from './claude-sdk/claude-sdk-stream-adapter.js';
import { CodexSdkStreamAdapter } from './codex-sdk/codex-sdk-stream-adapter.js';
import { CursorSdkStreamAdapter } from './cursor-sdk/cursor-sdk-stream-adapter.js';
import { PiSdkStreamAdapter } from './pi-sdk/pi-sdk-stream-adapter.js';
import {
  startSessionEventForwarder,
  type SessionEventForwarderClient,
} from './opencode-sdk/session-event-forwarder.js';
import { createHarnessActivityEmitter } from '../../../../services/service-interfaces.js';
import type { TurnCompletionResult } from './turn-completion.js';

type JsonRecord = Record<string, unknown>;
type LogEmitter = (line: string) => void;

function readFixture(name: string): JsonRecord[] {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as JsonRecord);
}

function createAdapter<T>(factory: (emit: LogEmitter) => T) {
  const emit: LogEmitter = vi.fn();
  const activityEmitter = createHarnessActivityEmitter();
  const adapter = factory(emit);
  return { adapter, emit, activityEmitter };
}

type FixtureOpenCodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
};

function readOpenCodeFixture(name: string): FixtureOpenCodeEvent[] {
  return readFixture(name).map((event) => ({
    type: String(event.type),
    ...(event.properties && typeof event.properties === 'object'
      ? { properties: event.properties as Record<string, unknown> }
      : {}),
  }));
}

async function expectResult(
  completion: { result: Promise<TurnCompletionResult> },
  expected: Pick<TurnCompletionResult, 'status' | 'source'>
): Promise<TurnCompletionResult> {
  const result = await completion.result;
  expect(result).toMatchObject(expected);
  return result;
}

describe('raw harness behavior fixtures', () => {
  it('Claude result is authoritative over stream completion', async () => {
    const { adapter } = createAdapter(
      (emit) =>
        new ClaudeSdkStreamAdapter('[claude-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('claude-sdk-success.jsonl')) {
      adapter.handleMessage(event as unknown as ClaudeMessage);
    }

    await expectResult(adapter.turnCompletion, {
      status: 'completed',
      source: 'claude-sdk.result',
    });
    adapter.finish();
  });

  it('Claude error result remains failed even with partial output', async () => {
    const { adapter } = createAdapter(
      (emit) =>
        new ClaudeSdkStreamAdapter('[claude-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('claude-sdk-failure.jsonl')) {
      adapter.handleMessage(event as unknown as ClaudeMessage);
    }

    await expectResult(adapter.turnCompletion, {
      status: 'failed',
      source: 'claude-sdk.result',
    });
  });

  it('Codex turn.completed and turn.failed are mutually exclusive terminals', async () => {
    const success = createAdapter(
      (emit) =>
        new CodexSdkStreamAdapter('[codex-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('codex-sdk-success.jsonl')) {
      success.adapter.handleEvent(event as unknown as ThreadEvent);
    }
    await expectResult(success.adapter.turnCompletion, {
      status: 'completed',
      source: 'codex-sdk.turn.completed',
    });

    const failure = createAdapter(
      (emit) =>
        new CodexSdkStreamAdapter('[codex-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('codex-sdk-failure.jsonl')) {
      failure.adapter.handleEvent(event as unknown as ThreadEvent);
    }
    await expectResult(failure.adapter.turnCompletion, {
      status: 'failed',
      source: 'codex-sdk.turn.failed',
    });
  });

  it('Cursor run status is adapted separately from stream activity', async () => {
    const success = createAdapter(
      (emit) =>
        new CursorSdkStreamAdapter('[cursor-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('cursor-sdk-success.jsonl')) {
      success.adapter.handleMessage(event as unknown as CursorMessage);
      if (event.type === 'status') {
        success.adapter.completeTurn({ status: 'completed', source: 'cursor-sdk.run.wait' });
      }
    }
    await expectResult(success.adapter.turnCompletion, {
      status: 'completed',
      source: 'cursor-sdk.run.wait',
    });

    const failure = createAdapter(
      (emit) =>
        new CursorSdkStreamAdapter('[cursor-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('cursor-sdk-failure.jsonl')) {
      failure.adapter.handleMessage(event as unknown as CursorMessage);
      if (event.type === 'status') {
        failure.adapter.completeTurn({
          status: 'failed',
          source: 'cursor-sdk.run.wait',
          error: String(event.message),
        });
      }
    }
    await expectResult(failure.adapter.turnCompletion, {
      status: 'failed',
      source: 'cursor-sdk.run.wait',
    });
  });

  it('Pi agent_end is the provider terminal signal, not tool completion', async () => {
    const { adapter } = createAdapter(
      (emit) => new PiSdkStreamAdapter('[pi-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('pi-sdk-success.jsonl')) {
      adapter.handleEvent(event as unknown as AgentSessionEvent);
    }
    await expectResult(adapter.turnCompletion, {
      status: 'completed',
      source: 'pi-sdk.agent_end',
    });
  });

  it('Pi stream ending after a tool failure does not become success in finish()', () => {
    const { adapter } = createAdapter(
      (emit) => new PiSdkStreamAdapter('[pi-sdk:fixture', emit, createHarnessActivityEmitter())
    );
    for (const event of readFixture('pi-sdk-failure.jsonl')) {
      adapter.handleEvent(event as unknown as AgentSessionEvent);
    }
    adapter.finish();

    expect(adapter.turnCompletion.isComplete).toBe(false);
  });

  it('OpenCode big-pickle-shaped SSE idle completes the armed turn once', async () => {
    const events = readOpenCodeFixture('opencode-big-pickle-success.jsonl');
    async function* stream(): AsyncGenerator<FixtureOpenCodeEvent> {
      for (const event of events) yield event;
    }
    const client: SessionEventForwarderClient = {
      event: { subscribe: async () => ({ stream: stream() }) },
    };
    const handle = startSessionEventForwarder(client, {
      sessionId: 'opencode-session-1',
      role: 'builder',
      target: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      errorTarget: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
    });
    handle.armTurnEnd();
    const results: TurnCompletionResult[] = [];
    handle.onTurnResult((result) => results.push(result));

    await handle.done;

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'completed',
      source: 'opencode.session.idle',
    });
  });

  it('OpenCode provider error wins over the following idle event', async () => {
    const events = readOpenCodeFixture('opencode-big-pickle-failure.jsonl');
    async function* stream(): AsyncGenerator<FixtureOpenCodeEvent> {
      for (const event of events) yield event;
    }
    const client: SessionEventForwarderClient = {
      event: { subscribe: async () => ({ stream: stream() }) },
    };
    const handle = startSessionEventForwarder(client, {
      sessionId: 'opencode-session-2',
      role: 'builder',
      target: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      errorTarget: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
    });
    handle.armTurnEnd();
    const results: TurnCompletionResult[] = [];
    handle.onTurnResult((result) => results.push(result));

    await handle.done;

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'failed',
      source: 'opencode.provider_rate_limit',
    });
  });
});
