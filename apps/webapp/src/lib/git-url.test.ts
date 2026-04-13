import { describe, expect, it } from 'vitest';
import { toRepoHttpsUrl } from './git-url';

describe('toRepoHttpsUrl', () => {
  // SSH format: git@host:owner/repo
  describe('SSH format (git@host:owner/repo)', () => {
    it('parses GitHub SSH URL', () => {
      expect(toRepoHttpsUrl('git@github.com:owner/repo')).toBe('https://github.com/owner/repo');
    });

    it('parses GitLab SSH URL', () => {
      expect(toRepoHttpsUrl('git@gitlab.com:owner/repo')).toBe('https://gitlab.com/owner/repo');
    });

    it('parses Bitbucket SSH URL', () => {
      expect(toRepoHttpsUrl('git@bitbucket.org:owner/repo')).toBe('https://bitbucket.org/owner/repo');
    });

    it('parses SSH URL with .git suffix', () => {
      expect(toRepoHttpsUrl('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo');
    });

    it('parses SSH URL with subpaths', () => {
      expect(toRepoHttpsUrl('git@github.com:owner/repo/submodule')).toBe(
        'https://github.com/owner/repo/submodule'
      );
    });
  });

  // SSH protocol format: ssh://git@host/path
  describe('SSH protocol format (ssh://git@host/path)', () => {
    it('parses ssh:// protocol URL', () => {
      expect(toRepoHttpsUrl('ssh://git@github.com/owner/repo')).toBe(
        'https://github.com/owner/repo'
      );
    });

    it('parses ssh:// without user', () => {
      expect(toRepoHttpsUrl('ssh://github.com/owner/repo')).toBe('https://github.com/owner/repo');
    });

    it('parses ssh:// with .git suffix', () => {
      expect(toRepoHttpsUrl('ssh://git@github.com/owner/repo.git')).toBe(
        'https://github.com/owner/repo'
      );
    });
  });

  // HTTPS format
  describe('HTTPS format', () => {
    it('parses GitHub HTTPS URL', () => {
      expect(toRepoHttpsUrl('https://github.com/owner/repo')).toBe(
        'https://github.com/owner/repo'
      );
    });

    it('parses GitLab HTTPS URL', () => {
      expect(toRepoHttpsUrl('https://gitlab.com/owner/repo')).toBe('https://gitlab.com/owner/repo');
    });

    it('parses Bitbucket HTTPS URL', () => {
      expect(toRepoHttpsUrl('https://bitbucket.org/owner/repo')).toBe(
        'https://bitbucket.org/owner/repo'
      );
    });

    it('parses HTTPS URL with .git suffix', () => {
      expect(toRepoHttpsUrl('https://github.com/owner/repo.git')).toBe(
        'https://github.com/owner/repo'
      );
    });

    it('parses HTTPS URL with port', () => {
      expect(toRepoHttpsUrl('https://github.com:443/owner/repo')).toBe(
        'https://github.com:443/owner/repo'
      );
    });
  });

  // HTTP format
  describe('HTTP format', () => {
    it('parses HTTP URL', () => {
      expect(toRepoHttpsUrl('http://github.com/owner/repo')).toBe(
        'http://github.com/owner/repo'
      );
    });

    it('parses HTTP URL with .git suffix', () => {
      expect(toRepoHttpsUrl('http://github.com/owner/repo.git')).toBe(
        'http://github.com/owner/repo'
      );
    });
  });

  // Edge cases
  describe('Edge cases', () => {
    it('trims whitespace', () => {
      expect(toRepoHttpsUrl('  git@github.com:owner/repo  ')).toBe(
        'https://github.com/owner/repo'
      );
      expect(toRepoHttpsUrl('\thttps://github.com/owner/repo\n')).toBe(
        'https://github.com/owner/repo'
      );
    });

    it('returns null for unrecognized format', () => {
      expect(toRepoHttpsUrl('invalid-url')).toBeNull();
      expect(toRepoHttpsUrl('')).toBeNull();
      expect(toRepoHttpsUrl('   ')).toBeNull();
    });

    it('handles self-hosted URLs', () => {
      expect(toRepoHttpsUrl('git@gitlab.internal:group/project')).toBe(
        'https://gitlab.internal/group/project'
      );
      expect(toRepoHttpsUrl('https://git.internal.company.com/owner/repo')).toBe(
        'https://git.internal.company.com/owner/repo'
      );
    });

    it('handles enterprise GitHub URLs', () => {
      expect(toRepoHttpsUrl('git@github.mycompany.com:owner/repo')).toBe(
        'https://github.mycompany.com/owner/repo'
      );
      expect(toRepoHttpsUrl('https://github.mycompany.com/owner/repo')).toBe(
        'https://github.mycompany.com/owner/repo'
      );
    });
  });
});
