import { describe, expect, it } from 'vitest';

import { fuzzyMatch, fuzzyFilter } from './fuzzyMatch';

describe('fuzzyMatch', () => {
  it('returns > 0 for exact match', () => {
    expect(fuzzyMatch('hello', 'hello')).toBeGreaterThan(0);
  });

  it('returns 0 for no match', () => {
    expect(fuzzyMatch('xyz', 'hello')).toBe(0);
  });

  it('returns > 0 for empty query (matches everything)', () => {
    expect(fuzzyMatch('', 'anything')).toBeGreaterThan(0);
  });

  it('returns 0 for empty target with non-empty query', () => {
    expect(fuzzyMatch('a', '')).toBe(0);
  });

  it('matches characters in order (non-contiguous)', () => {
    expect(fuzzyMatch('cmd', 'CommandPalette')).toBeGreaterThan(0);
  });

  it('is case insensitive', () => {
    expect(fuzzyMatch('CMD', 'CommandPalette')).toBeGreaterThan(0);
    expect(fuzzyMatch('cmd', 'COMMANDPALETTE')).toBeGreaterThan(0);
  });

  it('fails when characters are out of order', () => {
    expect(fuzzyMatch('dcb', 'abcd')).toBe(0);
  });

  it('scores prefix matches higher than non-prefix', () => {
    const prefixScore = fuzzyMatch('com', 'CommandPalette');
    const nonPrefixScore = fuzzyMatch('pal', 'CommandPalette');
    expect(prefixScore).toBeGreaterThan(nonPrefixScore);
  });

  it('scores consecutive matches higher than spread matches', () => {
    const consecutiveScore = fuzzyMatch('abc', 'abcdef');
    const spreadScore = fuzzyMatch('abc', 'axbxcx');
    expect(consecutiveScore).toBeGreaterThan(spreadScore);
  });

  it('handles path matching', () => {
    expect(fuzzyMatch('fm', 'src/lib/fuzzyMatch.ts')).toBeGreaterThan(0);
    expect(fuzzyMatch('fuzzy', 'src/lib/fuzzyMatch.ts')).toBeGreaterThan(0);
  });

  it('scores word boundary matches higher', () => {
    // "gp" matching at word boundaries (Git Panel) vs spread
    const boundaryScore = fuzzyMatch('gp', 'git-panel');
    const spreadScore = fuzzyMatch('gp', 'grouping');
    expect(boundaryScore).toBeGreaterThan(spreadScore);
  });

  it('handles camelCase boundaries', () => {
    const score = fuzzyMatch('CP', 'CommandPalette');
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 when query is longer than target', () => {
    expect(fuzzyMatch('abcdefgh', 'abc')).toBe(0);
  });

  it('filters out scattered matches for long queries like "package.json"', () => {
    // Direct filename match should score high
    const directMatch = fuzzyMatch('package.json', 'package.json');
    expect(directMatch).toBeGreaterThan(0);

    // Path containing the file should also match
    const pathMatch = fuzzyMatch('package.json', 'services/backend/package.json');
    expect(pathMatch).toBeGreaterThan(0);

    // Scattered characters across a long path should NOT match (or score very low)
    // e.g., p-a-c-k-a-g-e-.-j-s-o-n scattered in "src/components/PageContainer/index.json"
    const scatteredMatch = fuzzyMatch(
      'package.json',
      'src/components/PageContainer/KeyboardNavigation/helpers.ts'
    );
    expect(scatteredMatch).toBe(0);
  });

  it('matches special characters like .ts in file extensions', () => {
    expect(fuzzyMatch('.ts', 'fuzzyMatch.ts')).toBeGreaterThan(0);
    expect(fuzzyMatch('.tsx', 'Component.tsx')).toBeGreaterThan(0);
  });

  it('ranks exact extension matches higher than other matches', () => {
    // Searching ".csv" should rank "data.csv" higher than "csv_parser.ts"
    const extensionMatch = fuzzyMatch('.csv', 'data.csv');
    const nonExtensionMatch = fuzzyMatch('.csv', 'csv_parser.ts');
    expect(extensionMatch).toBeGreaterThan(nonExtensionMatch);
  });

  it('ranks suffix matches higher for extension-like queries', () => {
    // Searching ".ts" should rank files ending in .ts higher
    const tsFileScore = fuzzyMatch('.ts', 'utils.ts');
    const tsxFileScore = fuzzyMatch('.ts', 'Component.tsx');
    expect(tsFileScore).toBeGreaterThan(tsxFileScore);
  });

  it('matches single character queries', () => {
    expect(fuzzyMatch('c', 'CommandPalette')).toBeGreaterThan(0);
    expect(fuzzyMatch('z', 'abc')).toBe(0);
  });
});

describe('word prefix matching', () => {
  it('matches repo against Repository word in label', () => {
    expect(fuzzyMatch('repo', 'Github: View Repository')).toBeGreaterThan(0);
  });

  it('matches repo against Repository path segment', () => {
    expect(
      fuzzyMatch('repo', 'src/components/OldRepoAdapter/RepositoryBridge/index.ts')
    ).toBeGreaterThan(0);
  });

  it('matches repo against Repos directory segment', () => {
    expect(fuzzyMatch('repo', '/Users/me/Documents/Repos/chatroom')).toBeGreaterThan(0);
  });

  it('ranks prefix match on Repository above scattered path noise', () => {
    const prefix = fuzzyMatch('repo', 'src/Repository/index.ts');
    const scattered = fuzzyMatch('repo', 'src/components/OldRepoAdapter/RepositoryBridge/index.ts');
    expect(prefix).toBeGreaterThan(scattered);
  });

  it('fuzzyFilter uses prefix match via keywords basename', () => {
    expect(
      fuzzyFilter('src/components/OldRepoAdapter/RepositoryBridge/index.ts', 'repo', [
        'RepositoryBridge',
      ])
    ).toBeGreaterThan(0);
  });

  it('matches repo with trailing space against Repository word in label', () => {
    expect(fuzzyMatch('repo ', 'Github: View Repository')).toBeGreaterThan(0);
  });

  it('matches repo with trailing space against Repository path segment', () => {
    expect(fuzzyMatch('repo ', 'src/Repository/index.ts')).toBeGreaterThan(0);
  });

  it('ranks repo with trailing space on Repository above scattered path noise', () => {
    const prefix = fuzzyMatch('repo ', 'src/Repository/index.ts');
    const scattered = fuzzyMatch(
      'repo ',
      'src/components/OldRepoAdapter/RepositoryBridge/index.ts'
    );
    expect(prefix).toBeGreaterThan(scattered);
  });

  it('fuzzyFilter matches repo with trailing space via keywords', () => {
    expect(
      fuzzyFilter('src/components/OldRepoAdapter/RepositoryBridge/index.ts', 'repo ', [
        'RepositoryBridge',
      ])
    ).toBeGreaterThan(0);
  });
});

describe('command palette keyword matching', () => {
  const githubDesktopLabel = 'Machine: Open in GitHub Desktop';
  const viewRepoLabel = 'Github: View Repository';
  const workingDir = '/Users/me/Documents/Repos/chatroom';

  it('does not match GitHub Desktop when repo query only matches a parent path segment', () => {
    const fullPathKeywords = ['github desktop', 'localhost', workingDir];
    expect(fuzzyFilter(githubDesktopLabel, 'repo ', fullPathKeywords)).toBeGreaterThan(0);

    const basenameKeywords = ['github desktop', 'localhost', 'chatroom'];
    expect(fuzzyFilter(githubDesktopLabel, 'repo ', basenameKeywords)).toBe(0);
  });

  it('still matches View Repository via explicit repo keyword', () => {
    expect(
      fuzzyFilter(viewRepoLabel, 'repo ', ['repo', 'repository', 'github', 'localhost', 'chatroom'])
    ).toBeGreaterThan(0);
  });

  it('still matches commands by workspace basename', () => {
    expect(
      fuzzyFilter(githubDesktopLabel, 'chatroom', ['github desktop', 'localhost', 'chatroom'])
    ).toBeGreaterThan(0);
  });
});

describe('fuzzyFilter', () => {
  it('returns 0 for no match', () => {
    expect(fuzzyFilter('hello', 'xyz')).toBe(0);
  });

  it('returns > 0 for match (reversed args vs fuzzyMatch)', () => {
    // fuzzyFilter(value, search) -> fuzzyMatch(search, value)
    expect(fuzzyFilter('CommandPalette', 'cmd')).toBeGreaterThan(0);
  });

  it('returns > 0 for empty search', () => {
    expect(fuzzyFilter('anything', '')).toBeGreaterThan(0);
  });

  it('returns > 0 when keyword matches but value does not', () => {
    expect(fuzzyFilter('Github: View My Pull Requests', 'PR', ['PR', 'PRs'])).toBeGreaterThan(0);
  });

  it('returns the max score across value and keywords', () => {
    const valueOnly = fuzzyFilter('Pull Requests', 'PR');
    const withKeywords = fuzzyFilter('Pull Requests', 'PR', ['PR', 'PRs']);
    expect(withKeywords).toBeGreaterThanOrEqual(valueOnly);
  });

  it('works with no keywords (backward compatible)', () => {
    expect(fuzzyFilter('CommandPalette', 'cmd')).toBeGreaterThan(0);
    expect(fuzzyFilter('CommandPalette', 'cmd', undefined)).toBeGreaterThan(0);
    expect(fuzzyFilter('CommandPalette', 'cmd', [])).toBeGreaterThan(0);
  });
});
