/**
 * Generate 3D — the `--name` template for the package directory.
 *
 * A package is written as `<base>.zip` (and, in a later slice, `<base>.html`)
 * next to the master GLB. `<base>` comes from a template so the user can pin a
 * stable name, while the default stays unique per run.
 *
 * The rendered value becomes a file name. The two placeholders that carry
 * arbitrary input — `--out`'s stem and the model id — are sanitised first, then
 * the whole rendered name is validated: no path separators, no `..`, and only
 * the characters a portable file name allows.
 */

import { Generate3dError } from './model-registry.js';

/** Default package name: the master file's stem plus a UTC timestamp. */
export const DEFAULT_NAME_TEMPLATE = '{stem}-{timestamp}';

/** Placeholder names a template may use. */
const PLACEHOLDERS = ['stem', 'model', 'timestamp', 'requestId8'] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

/** The placeholder list as it appears in error messages. */
const PLACEHOLDER_LIST = PLACEHOLDERS.map((name) => `{${name}}`).join(', ');

/** A portable file name: starts alphanumeric, then alphanumerics, dot, dash, underscore. */
const SAFE_BASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** What a name part becomes when every character in it is unusable. */
const EMPTY_NAME_PART = 'asset';

/**
 * Make one substituted value safe for a file name.
 *
 * Everything outside the portable set collapses to `-`, and a leading
 * non-alphanumeric is dropped so `_tmp` and `.hidden` cannot produce a hidden or
 * flag-like file. A value with nothing usable left (a non-ASCII stem, for
 * example) becomes {@link EMPTY_NAME_PART} instead of rendering an empty part
 * that would leave a dangling separator.
 *
 * This is how `--out "My Chest.glb"` and a model id such as
 * `meshy/v7.1/text-to-3d` both become valid name parts.
 */
function sanitizeNamePart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return sanitized.length === 0 ? EMPTY_NAME_PART : sanitized;
}

export interface PackageNameVars {
  /** Basename of `--out` without its extension. */
  stem: string;
  /** Model id; `/` is replaced with `-` so it is safe in a file name. */
  model: string;
  /** UTC `YYYYMMDD-HHmmss`, taken once before the fal call. */
  timestamp: string;
  /** First 8 characters of the fal request id; known only after the call. */
  requestId8?: string | undefined;
}

/**
 * UTC `YYYYMMDD-HHmmss`, the form the default template embeds.
 *
 * UTC keeps the rendered name identical on every machine; a local timestamp
 * would make the same run produce a different name depending on the timezone.
 */
export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/** True when the template cannot render until the fal request id is known. */
export function templateNeedsRequestId(template: string): boolean {
  return template.includes('{requestId8}');
}

function isPlaceholder(value: string): value is Placeholder {
  return (PLACEHOLDERS as readonly string[]).includes(value);
}

/** Every `{...}` token in the template, in order; braces without a close are unmatched. */
function placeholderTokens(template: string): string[] {
  const tokens: string[] = [];
  const pattern = /\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    tokens.push(match[1] as string);
  }
  return tokens;
}

/** The error for a placeholder the template may not use. */
function unknownPlaceholderError(token: string): Generate3dError {
  return new Generate3dError(`Unknown --name placeholder "{${token}}". Use ${PLACEHOLDER_LIST}.`);
}

/** Braces that never close would otherwise be substituted into the name verbatim. */
function requireClosedBraces(template: string): void {
  const withoutTokens = template.replace(/\{[^{}]*\}/g, '');
  if (withoutTokens.includes('{') || withoutTokens.includes('}')) {
    throw new Generate3dError(`Unclosed brace in --name "${template}". Use ${PLACEHOLDER_LIST}.`);
  }
}

/**
 * Reject an unknown or unclosed placeholder before substituting anything, so a
 * typo cannot silently become a file name with braces in it.
 */
function requireKnownPlaceholders(template: string): void {
  const unknown = placeholderTokens(template).find((token) => !isPlaceholder(token));
  if (unknown !== undefined) throw unknownPlaceholderError(unknown);
  requireClosedBraces(template);
}

/** The request id is optional in the vars because it only exists after the call. */
function requireRequestId8(vars: PackageNameVars): string {
  if (vars.requestId8 === undefined) {
    throw new Generate3dError(
      `--name uses {requestId8}, which is only known after the fal call; pass the request id to render it.`
    );
  }
  return vars.requestId8;
}

/**
 * One value per placeholder. `{stem}` and `{model}` are sanitised because they
 * carry arbitrary input: an `--out` path segment and a fal model id.
 */
const PLACEHOLDER_VALUES: Record<Placeholder, (vars: PackageNameVars) => string> = {
  stem: (vars) => sanitizeNamePart(vars.stem),
  model: (vars) => sanitizeNamePart(vars.model),
  timestamp: (vars) => vars.timestamp,
  requestId8: (vars) => requireRequestId8(vars),
};

/** Substitute every placeholder; unknown tokens are impossible at this point. */
function substitute(template: string, vars: PackageNameVars): string {
  return template.replace(/\{([^{}]*)\}/g, (_match, token: string) =>
    isPlaceholder(token) ? PLACEHOLDER_VALUES[token](vars) : token
  );
}

/** Where a rendered name came from, for the error messages. */
function describeSource(template: string, stem: string): string {
  return template.includes('{stem}')
    ? `template "${template}" with {stem} "${stem}"`
    : `template "${template}"`;
}

/** The checks a rendered name has to pass, in reporting order. */
const NAME_PROBLEMS: readonly { matches: (rendered: string) => boolean; description: string }[] = [
  {
    matches: (rendered) => rendered.includes('/') || rendered.includes('\\'),
    description: 'a path separator',
  },
  {
    matches: (rendered) => rendered.includes('..'),
    description: 'a parent-directory segment, which would leave the package directory',
  },
  {
    matches: (rendered) => !SAFE_BASE_NAME.test(rendered),
    description: 'a character outside the portable file-name set',
  },
];

/** Reject a rendered name that could not be a plain file name. */
function requirePortableName(rendered: string, source: string): void {
  const problem = NAME_PROBLEMS.find((candidate) => candidate.matches(rendered));
  if (problem !== undefined) {
    throw new Generate3dError(
      `--name rendered "${rendered}" (${source}) containing ${problem.description}, which is not a valid file name. Use letters, digits, dot, dash, and underscore, starting with a letter or digit.`
    );
  }
}

export function renderPackageName(template: string, vars: PackageNameVars): string {
  requireKnownPlaceholders(template);
  const rendered = substitute(template, vars);
  requirePortableName(rendered, describeSource(template, vars.stem));
  return rendered;
}
