import { describe, it, expect } from 'vitest';
import React from 'react';
import { linkifyGitHubRefs } from './github-refs';

// Helper to extract text content from a React.ReactNode[]
function textOf(nodes: React.ReactNode[]): string {
  return nodes
    .map((n) => {
      if (typeof n === 'string') return n;
      if (React.isValidElement(n)) {
        const children = (n.props as { children?: React.ReactNode }).children;
        return typeof children === 'string' ? children : '';
      }
      return '';
    })
    .join('');
}

function linksOf(nodes: React.ReactNode[]): Array<{ text: string; href: string }> {
  return nodes
    .filter((n): n is React.ReactElement => React.isValidElement(n))
    .map((el) => ({
      text: (el.props as { children: string }).children,
      href: (el.props as { href: string }).href,
    }));
}

describe('linkifyGitHubRefs', () => {
  it('linkifies #NNN with repoSlug to correct URL', () => {
    const nodes = linkifyGitHubRefs('Fixes #482', { repoSlug: 'owner/repo' });
    const links = linksOf(nodes);
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('https://github.com/owner/repo/issues/482');
    expect(links[0]?.text).toBe('#482');
  });

  it('linkifies owner/repo#NNN ignoring the default slug', () => {
    const nodes = linkifyGitHubRefs('See acme/foo#9 for more', { repoSlug: 'default/repo' });
    const links = linksOf(nodes);
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('https://github.com/acme/foo/issues/9');
    expect(links[0]?.text).toBe('acme/foo#9');
  });

  it('returns plain text when repoSlug is null and no explicit slug', () => {
    const nodes = linkifyGitHubRefs('See #1 for details', { repoSlug: null });
    expect(linksOf(nodes)).toHaveLength(0);
    expect(textOf(nodes)).toBe('See #1 for details');
  });

  it('linkifies owner/repo#NNN even when repoSlug is null', () => {
    const nodes = linkifyGitHubRefs('See acme/bar#10', { repoSlug: null });
    const links = linksOf(nodes);
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('https://github.com/acme/bar/issues/10');
  });

  it('handles multiple references interleaved with plain text', () => {
    const nodes = linkifyGitHubRefs('Closes #1 and #2, see also org/repo#5', {
      repoSlug: 'owner/repo',
    });
    const links = linksOf(nodes);
    expect(links).toHaveLength(3);
    expect(links[0]?.href).toBe('https://github.com/owner/repo/issues/1');
    expect(links[1]?.href).toBe('https://github.com/owner/repo/issues/2');
    expect(links[2]?.href).toBe('https://github.com/org/repo/issues/5');
    expect(textOf(nodes)).toBe('Closes #1 and #2, see also org/repo#5');
  });

  it('does not linkify #abc (non-numeric)', () => {
    const nodes = linkifyGitHubRefs('See #abc', { repoSlug: 'owner/repo' });
    expect(linksOf(nodes)).toHaveLength(0);
    expect(textOf(nodes)).toBe('See #abc');
  });

  it('linkifies only the #NNN part when preceded by "Closes "', () => {
    const nodes = linkifyGitHubRefs('Closes #5', { repoSlug: 'owner/repo' });
    const links = linksOf(nodes);
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe('#5');
    // Verify plain text segments
    const strings = nodes.filter((n): n is string => typeof n === 'string');
    expect(strings).toContain('Closes ');
  });

  it('returns original text in single-element array when no refs found', () => {
    const nodes = linkifyGitHubRefs('No refs here', { repoSlug: 'owner/repo' });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toBe('No refs here');
  });

  it('links have target="_blank" and rel="noopener noreferrer"', () => {
    const nodes = linkifyGitHubRefs('#42', { repoSlug: 'owner/repo' });
    const link = linksOf(nodes)[0];
    const el = nodes.find((n): n is React.ReactElement => React.isValidElement(n))!;
    expect((el.props as { target: string }).target).toBe('_blank');
    expect((el.props as { rel: string }).rel).toBe('noopener noreferrer');
    expect(link).toBeDefined();
  });
});
