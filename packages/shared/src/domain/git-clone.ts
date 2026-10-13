export const GIT_CLONE_STATUSES = ['pending', 'cloning', 'completed', 'failed'] as const;
export type GitCloneStatus = (typeof GIT_CLONE_STATUSES)[number];
export const GIT_CLONE_ERROR_CODES = [
  'target_not_empty',
  'auth',
  'repo_not_found',
  'network',
  'git_missing',
  'timeout',
  'invalid_request',
  'unknown',
] as const;
export type GitCloneErrorCode = (typeof GIT_CLONE_ERROR_CODES)[number];
/** Passed as GIT_ALLOW_PROTOCOL to git; blocks ext::, fd::, file. */
export const GIT_CLONE_ALLOWED_PROTOCOLS = 'https:http:ssh:git';
export const GIT_CLONE_MAX_URL_LENGTH = 2048;
export const GIT_CLONE_ERROR_MESSAGES: Record<GitCloneErrorCode, string> = {
  target_not_empty:
    'The target folder already exists and is not empty. Choose a different path or remove the folder.',
  auth: 'Authentication failed. Check that this machine has access to the repository (SSH key or credential helper).',
  repo_not_found: 'Repository not found. Check the URL and your access.',
  network: 'Network error while contacting the git host. Check connectivity and try again.',
  git_missing: 'git is not installed or not on PATH on this machine.',
  timeout: 'The clone took too long and was stopped.',
  invalid_request: 'The repository URL or target path is invalid.',
  unknown: 'The clone failed.',
};

export type GitCloneUrlValidation = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Accepted URL shapes, each with a host that must start with an alphanumeric character
 * (so git never sees a host that looks like a command-line option):
 * - `https://`, `http://`, `ssh://`, `git://` URLs with an optional `user@` and `:port`
 * - scp-like `user@host:path`
 */
const SCHEME_URL_PATTERN =
  /^(?:https?|ssh|git):\/\/(?:[^\s/@-][^\s/@]*@)?[A-Za-z0-9][A-Za-z0-9.-]*(?::\d+)?\/\S+$/i;
const SCP_LIKE_PATTERN = /^[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9.-]*:(?!-)\S+$/;
/** Whitespace, ASCII control characters (including NUL) and DEL. */
const WHITESPACE_OR_CONTROL_PATTERN = /[\s\x00-\x1f\x7f]/;

/**
 * Validates a git repository URL before it is enqueued for a daemon clone.
 * Accepts https://, http://, ssh://, git:// URLs and scp-like user@host:path.
 * Rejects: empty, > GIT_CLONE_MAX_URL_LENGTH, whitespace/control chars/NUL, leading '-',
 * '::' transports (ext::, fd::), file://, bare local paths.
 * Returns the trimmed url on success.
 */
/** Hard rejections, checked in order against the trimmed URL. The first match wins. */
const GIT_CLONE_URL_REJECTIONS: readonly {
  matches: (url: string) => boolean;
  reason: string;
}[] = [
  { matches: (url) => url.length === 0, reason: 'Repository URL is required' },
  {
    matches: (url) => url.length > GIT_CLONE_MAX_URL_LENGTH,
    reason: `Repository URL is too long (max ${GIT_CLONE_MAX_URL_LENGTH} characters)`,
  },
  {
    matches: (url) => WHITESPACE_OR_CONTROL_PATTERN.test(url),
    reason: 'Repository URL must not contain whitespace or control characters',
  },
  // Leading '-' would be parsed as a git/ssh option.
  {
    matches: (url) => url.startsWith('-'),
    reason: 'Repository URL must not start with "-"',
  },
  // '::' selects git remote-helper transports such as ext:: and fd::.
  {
    matches: (url) => url.includes('::'),
    reason: 'Repository URL uses a disallowed transport',
  },
];

export function validateGitCloneUrl(raw: string): GitCloneUrlValidation {
  const url = raw.trim();
  const rejection = GIT_CLONE_URL_REJECTIONS.find((rule) => rule.matches(url));
  if (rejection) {
    return { ok: false, reason: rejection.reason };
  }
  if (SCHEME_URL_PATTERN.test(url) || SCP_LIKE_PATTERN.test(url)) {
    return { ok: true, url };
  }
  return {
    ok: false,
    reason: 'Repository URL must be an https://, http://, ssh://, git:// or user@host:path URL',
  };
}

/**
 * Derives the default clone folder name from a repository URL.
 * "https://github.com/acme/my-repo.git" → "my-repo"; "git@github.com:acme/x.git/" → "x".
 * Sanitizes to [A-Za-z0-9._-] (other characters become '-'). Leading dots are removed so the
 * result can never be '.' or '..'. Returns null when nothing usable remains.
 */
export function deriveRepoFolderName(url: string): string | null {
  const withoutTrailingSlashes = url.trim().replace(/\/+$/, '');
  const lastSegment = withoutTrailingSlashes.split(/[/:]/).pop() ?? '';
  const withoutGitSuffix = lastSegment.replace(/\.git$/i, '');
  const sanitized = withoutGitSuffix.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '');
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Joins a parent directory and a folder name into a clone target path.
 * joinClonePath('/Users/me/src/', 'my-repo') → '/Users/me/src/my-repo'.
 */
export function joinClonePath(parentDir: string, folderName: string): string {
  return `${parentDir.replace(/\/+$/, '')}/${folderName}`;
}
