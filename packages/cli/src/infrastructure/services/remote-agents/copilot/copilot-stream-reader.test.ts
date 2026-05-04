import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { CopilotStreamReader } from './copilot-stream-reader.js';

describe('CopilotStreamReader', () => {
  /**
   * Helper to create a readable stream from an array of lines
   */
  function createStream(lines: string[]): Readable {
    const data = lines.join('\n') + '\n';
    const stream = new Readable();
    stream.push(data);
    stream.push(null);
    return stream;
  }

  it('fires onText for each non-empty line', () => {
    const stream = createStream([
      '● Print hello to stdout',
      '$ echo "hello"',
      '└ 2 lines...',
    ]);

    const onText = vi.fn();
    const reader = new CopilotStreamReader(stream);
    reader.onText(onText);

    // Wait for stream to be consumed
    return new Promise<void>((resolve) => {
      stream.on('end', () => {
        expect(onText).toHaveBeenCalledTimes(3);
        expect(onText).toHaveBeenCalledWith('● Print hello to stdout');
        expect(onText).toHaveBeenCalledWith('$ echo "hello"');
        expect(onText).toHaveBeenCalledWith('└ 2 lines...');
        resolve();
      });
    });
  });

  it('fires onAgentEnd when Done. is received', () => {
    const stream = createStream([
      '● Print hello to stdout',
      '$ echo "hello"',
      'Done.',
    ]);

    const onAgentEnd = vi.fn();
    const reader = new CopilotStreamReader(stream);
    reader.onAgentEnd(onAgentEnd);

    return new Promise<void>((resolve) => {
      stream.on('end', () => {
        expect(onAgentEnd).toHaveBeenCalledTimes(1);
        resolve();
      });
    });
  });

  it('skips metadata lines (usage stats)', () => {
    const stream = createStream([
      '● Print hello to stdout',
      'Total usage est:        0.33 Premium requests',
      'API time spent:         5s',
      'Done.',
    ]);

    const onText = vi.fn();
    const reader = new CopilotStreamReader(stream);
    reader.onText(onText);

    return new Promise<void>((resolve) => {
      stream.on('end', () => {
        // Should only call onText for the action line, not metadata
        expect(onText).toHaveBeenCalledTimes(1);
        expect(onText).toHaveBeenCalledWith('● Print hello to stdout');
        resolve();
      });
    });
  });

  it('fires onAnyEvent for each line', () => {
    const stream = createStream([
      '● Print hello to stdout',
      'Done.',
    ]);

    const onAnyEvent = vi.fn();
    const reader = new CopilotStreamReader(stream);
    reader.onAnyEvent(onAnyEvent);

    return new Promise<void>((resolve) => {
      stream.on('end', () => {
        // Should fire for both lines including Done.
        expect(onAnyEvent).toHaveBeenCalledTimes(2);
        resolve();
      });
    });
  });

  it('skips empty lines', () => {
    const stream = createStream([
      '● Print hello to stdout',
      '',
      '$ echo "hello"',
      '',
      'Done.',
    ]);

    const onText = vi.fn();
    const reader = new CopilotStreamReader(stream);
    reader.onText(onText);

    return new Promise<void>((resolve) => {
      stream.on('end', () => {
        expect(onText).toHaveBeenCalledTimes(2);
        resolve();
      });
    });
  });
});
