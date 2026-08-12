import { describe, expect, it } from 'vitest';

import { listHarnessHistory, type HarnessStreamReader } from './list-harness-history.js';

describe('listHarnessHistory', () => {
  it('delegates to repository with default limit', () => {
    const repo: HarnessStreamReader = {
      listLines: (opts) => {
        expect(opts?.limit).toBe(500);
        return [
          {
            type: 'harness.stream',
            harness: 'h1',
            stream: 'stdout',
            line: 'hello',
            timestamp: 1,
          },
        ];
      },
    };
    const result = listHarnessHistory(repo);
    expect(result.lines).toHaveLength(1);
  });
});
