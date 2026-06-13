import { describe, expect, it } from 'vitest';

import { emptySpawnBracket, recordSpawn, recordExit, bracketCountAfter } from './spawn-bracket.js';

describe('recordSpawn', () => {
  it('increments concurrent count', () => {
    const initial = emptySpawnBracket();
    const after = recordSpawn(initial);
    expect(after.concurrentCount).toBe(1);
  });

  it('increments from non-zero', () => {
    const state = recordSpawn(emptySpawnBracket());
    const after = recordSpawn(state);
    expect(after.concurrentCount).toBe(2);
  });
});

describe('recordExit', () => {
  it('decrements concurrent count', () => {
    const state = recordSpawn(emptySpawnBracket());
    const after = recordExit(state);
    expect(after.concurrentCount).toBe(0);
  });

  it('never goes below 0', () => {
    const after = recordExit(emptySpawnBracket());
    expect(after.concurrentCount).toBe(0);
  });

  it('clamps at 0 after multiple exits', () => {
    const s1 = recordSpawn(emptySpawnBracket());
    const s2 = recordSpawn(s1);
    const s3 = recordExit(s2);
    const s4 = recordExit(s3);
    const s5 = recordExit(s4);
    expect(s5.concurrentCount).toBe(0);
  });
});

describe('spawn/exit sequences', () => {
  it('[spawn, spawn, exit, exit] → count 0', () => {
    const s1 = recordSpawn(emptySpawnBracket());
    const s2 = recordSpawn(s1);
    const s3 = recordExit(s2);
    const s4 = recordExit(s3);
    expect(s4.concurrentCount).toBe(0);
  });

  it('[spawn, exit, exit] → count 0 (no negative)', () => {
    const s1 = recordSpawn(emptySpawnBracket());
    const s2 = recordExit(s1);
    const s3 = recordExit(s2);
    expect(s3.concurrentCount).toBe(0);
  });
});

describe('bracketCountAfter', () => {
  it('returns max(0, spawns - exits)', () => {
    expect(bracketCountAfter(5, 3)).toBe(2);
    expect(bracketCountAfter(3, 5)).toBe(0);
    expect(bracketCountAfter(0, 0)).toBe(0);
    expect(bracketCountAfter(10, 0)).toBe(10);
  });
});
