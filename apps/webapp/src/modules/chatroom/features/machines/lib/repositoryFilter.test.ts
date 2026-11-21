import { describe, expect, it } from 'vitest';

import { filterRepositories } from './repositoryFilter';
import type { LedgerEntryView } from '../hooks/useRepositoryLedger';

const entries: LedgerEntryView[] = [
  {
    path: '/Users/me/projects/api-service',
    name: 'Api-Service',
    root: '/Users/me/projects',
    branch: 'main',
    discoveredAt: 1,
    hasChatroom: false,
  },
  {
    path: '/Users/me/work/web',
    name: 'web',
    root: '/Users/me/work',
    branch: 'feat/Login',
    discoveredAt: 1,
    hasChatroom: true,
  },
  {
    path: '/Users/me/projects/docs',
    name: 'docs',
    root: '/Users/me/projects',
    discoveredAt: 1,
    hasChatroom: false,
  },
];

describe('filterRepositories', () => {
  it('returns the same array for an empty or blank filter', () => {
    expect(filterRepositories(entries, '')).toBe(entries);
    expect(filterRepositories(entries, '   ')).toBe(entries);
  });

  it('matches the name case-insensitively and ignores surrounding spaces', () => {
    expect(filterRepositories(entries, '  API ').map((e) => e.name)).toEqual(['Api-Service']);
  });

  it('matches the path', () => {
    expect(filterRepositories(entries, 'projects').map((e) => e.name)).toEqual([
      'Api-Service',
      'docs',
    ]);
  });

  it('matches the branch, case-insensitively', () => {
    expect(filterRepositories(entries, 'LOGIN').map((e) => e.name)).toEqual(['web']);
  });

  it('returns no rows when nothing matches', () => {
    expect(filterRepositories(entries, 'zzz')).toEqual([]);
  });
});
