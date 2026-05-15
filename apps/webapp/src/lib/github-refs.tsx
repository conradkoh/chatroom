import React from 'react';

export interface LinkifyOptions {
  /**
   * owner/repo slug used as the default repository for `#NNN` references.
   * Pass null to disable linking for bare `#NNN` references without an explicit owner/repo prefix.
   */
  repoSlug: string | null;
}

/**
 * Converts GitHub references in `text` into clickable links.
 *
 * Supports:
 * - `#NNN` → https://github.com/<repoSlug>/issues/NNN (GitHub redirects to PR if applicable)
 * - `owner/repo#NNN` → https://github.com/owner/repo/issues/NNN
 *
 * Returns plain text (single-element array) when `repoSlug` is null and no
 * explicit owner/repo prefix is present.
 * Anchors open in a new tab with `rel="noopener noreferrer"`.
 */
export function linkifyGitHubRefs(text: string, options: LinkifyOptions): React.ReactNode[] {
  // Matches:
  //   - optional owner/repo prefix: ([\w.-]+\/[\w.-]+)
  //   - followed by #NNN
  const GITHUB_REF_RE = /(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = GITHUB_REF_RE.exec(text)) !== null) {
    const [fullMatch, crossRepoSlug, prNumber] = match;
    const matchStart = match.index;

    // Push any plain text before this match
    if (matchStart > lastIndex) {
      nodes.push(text.slice(lastIndex, matchStart));
    }

    const slug = crossRepoSlug ?? options.repoSlug;
    if (slug !== null) {
      const url = `https://github.com/${slug}/issues/${prNumber}`;
      nodes.push(
        <a
          key={matchStart}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-chatroom-accent hover:underline"
        >
          {fullMatch}
        </a>
      );
    } else {
      // No slug available — render as plain text
      nodes.push(fullMatch);
    }

    lastIndex = matchStart + fullMatch.length;
  }

  // Push any remaining plain text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  // If nothing was matched, return the original text in a single-element array
  if (nodes.length === 0) {
    return [text];
  }

  return nodes;
}
