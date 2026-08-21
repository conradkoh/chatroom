import { describe, expect, it } from 'vitest';

import {
  countDataFilesByParent,
  scoreFile,
  SCORE_MARKDOWN,
  compareRankedFiles,
  isConfigFile,
  isDataFile,
} from './file-tree-sync-ranker.js';

describe('file tree sync ranker', () => {
  it('ranks source above dumps', () => {
    const files = ['dumps/a.json', 'dumps/b.json', 'src/index.ts'];
    const m = countDataFilesByParent(files);
    expect(scoreFile('src/index.ts', m)).toBeGreaterThan(scoreFile('dumps/a.json', m));
  });
  it('scores markdown and recognizes config', () => {
    const m = new Map();
    expect(scoreFile('README.md', m)).toBe(SCORE_MARKDOWN);
    expect(isConfigFile('package.json')).toBe(true);
    expect(isDataFile('package.json')).toBe(false);
  });
  it('penalizes build output and sorts deterministically', () => {
    const m = new Map();
    expect(scoreFile('dist/app.js', m)).toBeLessThan(0);
    expect(scoreFile('app.min.js', m)).toBeLessThan(0);
    expect(compareRankedFiles('a.ts', 1, 'b.ts', 1)).toBeLessThan(0);
    expect(compareRankedFiles('a/b.ts', 1, 'c.ts', 1)).toBeGreaterThan(0);
  });
  it('applies data sibling penalty', () => {
    const files = Array.from({ length: 10 }, (_, i) => `data/${i}.json`);
    const m = countDataFilesByParent(files);
    expect(scoreFile(files[0], m)).toBe(-100);
  });
});
