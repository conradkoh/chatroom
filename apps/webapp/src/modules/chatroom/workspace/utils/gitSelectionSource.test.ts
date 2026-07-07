import { describe, expect, it } from 'vitest';

import { buildGitSelectionSource } from './gitSelectionSource';

describe('buildGitSelectionSource', () => {
  it('returns working-tree file source', () => {
    expect(buildGitSelectionSource({ type: 'working-tree' }, 'file', 'src/index.ts')).toBe(
      'git:working-tree:src/index.ts'
    );
  });

  it('returns commit file source', () => {
    expect(buildGitSelectionSource({ type: 'commit', sha: 'abc123' }, 'file', 'src/index.ts')).toBe(
      'git:commit:abc123:src/index.ts'
    );
  });

  it('returns commit message source', () => {
    expect(buildGitSelectionSource({ type: 'commit', sha: 'abc123' }, 'commit-message')).toBe(
      'git:commit:abc123'
    );
  });

  it('returns unknown when source is missing', () => {
    expect(buildGitSelectionSource(null, 'file', 'src/index.ts')).toBe('git:unknown');
  });
});
