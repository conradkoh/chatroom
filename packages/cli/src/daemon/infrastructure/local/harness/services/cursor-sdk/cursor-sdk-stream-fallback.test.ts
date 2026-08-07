import type { InteractionUpdate, SDKMessage } from '@cursor/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  logUnhandledInteractionDelta,
  logUnhandledSdkMessage,
} from './cursor-sdk-stream-fallback.js';

const LOG_PREFIX = '[cursor-sdk:builder@test';

describe('cursor-sdk-stream-fallback', () => {
  it('logUnhandledSdkMessage writes a stream:unhandled line with truncated JSON', () => {
    const writeLine = vi.fn();
    const message = {
      type: 'mystery',
      note: 'x'.repeat(600),
    } as unknown as SDKMessage;

    logUnhandledSdkMessage(LOG_PREFIX, message, writeLine);

    const [line] = writeLine.mock.calls[0] as [string];
    expect(line).toMatch(/^\[cursor-sdk:builder@test stream:unhandled\] mystery: \{/);
    expect(line).toMatch(/…$/);
    const json = line.slice(line.indexOf('mystery: ') + 'mystery: '.length);
    expect(json.length).toBe(500 + 1);
  });

  it('logUnhandledSdkMessage does not truncate short payloads', () => {
    const writeLine = vi.fn();
    logUnhandledSdkMessage(LOG_PREFIX, { type: 'request' } as unknown as SDKMessage, writeLine);

    expect(writeLine).toHaveBeenCalledWith(
      `${LOG_PREFIX} stream:unhandled] request: {"type":"request"}`
    );
  });

  it('logUnhandledInteractionDelta writes a delta:unhandled line', () => {
    const writeLine = vi.fn();
    const update = { type: 'mystery-delta' } as unknown as InteractionUpdate;

    logUnhandledInteractionDelta(LOG_PREFIX, update, writeLine);

    expect(writeLine).toHaveBeenCalledWith(
      `${LOG_PREFIX} delta:unhandled] mystery-delta: {"type":"mystery-delta"}`
    );
  });
});
