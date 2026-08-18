import { describe, it, expect, vi } from 'vitest';

import {
  ENHANCER_LOG_PREFIX,
  createEnhancerLogWriter,
  formatEnhancerLogLine,
} from './enhancer-log.js';

describe('formatEnhancerLogLine', () => {
  it('prefixes plain messages', () => {
    expect(formatEnhancerLogLine('claimed job=abc')).toBe('[enhancer] claimed job=abc');
  });
  it('does not double-prefix', () => {
    expect(formatEnhancerLogLine(`${ENHANCER_LOG_PREFIX} already prefixed`)).toBe(
      `${ENHANCER_LOG_PREFIX} already prefixed`
    );
  });
  it('preserves harness log content after prefix', () => {
    const harnessLine = '[2026-07-25T00:00:00.000Z] role:enhancer text] hello';
    expect(formatEnhancerLogLine(harnessLine)).toBe(`[enhancer] ${harnessLine}`);
  });
});

describe('createEnhancerLogWriter', () => {
  it('writes formatted lines to stdout and log sink with enhancer metadata', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logSink = { write: vi.fn() };
    const writer = createEnhancerLogWriter(
      logSink,
      {
        chatroomId: 'room1',
        harness: 'codex-sdk',
        pid: 42,
      },
      () => 1_700_000_000_000
    );

    writer.write('claimed job=abc');

    expect(stdoutSpy).toHaveBeenCalledWith('[enhancer] claimed job=abc\n');
    expect(logSink.write).toHaveBeenCalledWith({
      timestamp: 1_700_000_000_000,
      level: 'info',
      source: 'harness:codex-sdk',
      stream: 'stdout',
      message: '[enhancer] claimed job=abc',
      metadata: {
        chatroomId: 'room1',
        role: 'enhancer',
        harness: 'codex-sdk',
        pid: 42,
      },
    });

    stdoutSpy.mockRestore();
  });
});
