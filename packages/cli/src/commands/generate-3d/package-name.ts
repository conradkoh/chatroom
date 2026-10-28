/**
 * Generate 3D — the `--name` template for the package directory.
 *
 * A package is written as `<base>.zip` (and, in a later slice, `<base>.html`)
 * next to the master GLB. `<base>` comes from a template so the user can pin a
 * stable name, while the default stays unique per run.
 *
 * The rendered value becomes a file name, so every placeholder is validated
 * after substitution: no path separators, no `..`, and only the characters a
 * portable file name allows.
 */

import { Generate3dError } from './model-registry.js';

/** Default package name: the master file's stem plus a UTC timestamp. */
export const DEFAULT_NAME_TEMPLATE = '{stem}-{timestamp}';

/** Placeholder names a template may use. */
const PLACEHOLDERS = ['stem', 'model', 'timestamp', 'requestId8'] as const;
type Placeholder = (typeof PLACEHOLDERS)[number];

/** A portable file name: starts alphanumeric, then alphanumerics, dot, dash, underscore. */
const SAFE_BASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

/**
 * Reject an unknown or unclosed placeholder before substituting anything, so a
 * typo cannot silently become a file name with braces in it.
 */
function requireKnownPlaceholders(template: string): void {
  for (const token of placeholderTokens(template)) {
    if (!isPlaceholder(token)) {
      throw new Generate3dError(
        `Unknown --name placeholder "{${token}}". Use ${PLACEHOLDERS.map((name) => `{${name}}`).join(', ')}.`
      );
    }
  }
  const withoutTokens = template.replace(/\{[^{}]*\}/g, '');
  if (withoutTokens.includes('{') || withoutTokens.includes('}')) {
    throw new Generate3dError(
      `Unclosed brace in --name "${template}". Use ${PLACEHOLDERS.map((name) => `{${name}}`).join(', ')}.`
    );
  }
}

/** Substitute every placeholder; `{model}` is the only value needing sanitising. */
function substitute(template: string, vars: PackageNameVars): string {
  return template.replace(/\{([^{}]*)\}/g, (_match, token: string) => {
    switch (token) {
      case 'stem':
        return vars.stem;
      case 'model':
        return vars.model.replaceAll('/', '-');
      case 'timestamp':
        return vars.timestamp;
      case 'requestId8':
        if (vars.requestId8 === undefined) {
          throw new Generate3dError(
            `--name uses {requestId8}, which is only known after the fal call; pass the request id to render it.`
          );
        }
        return vars.requestId8;
      default:
        // requireKnownPlaceholders has already rejected unknown tokens.
        throw new Generate3dError(`Unknown --name placeholder "{${token}}".`);
    }
  });
}

/**
 * Render the package base name.
 *
 * Throws `Generate3dError` for an unknown placeholder, a missing
 * `{requestId8}` value, a path separator, `..`, or a character outside the
 * portable file-name set.
 */
export function renderPackageName(template: string, vars: PackageNameVars): string {
  requireKnownPlaceholders(template);
  const rendered = substitute(template, vars);
  if (rendered.includes('/') || rendered.includes('\\')) {
    throw new Generate3dError(
      `--name rendered a path separator in "${rendered}". Use a plain file name, for example ${DEFAULT_NAME_TEMPLATE}.`
    );
  }
  if (rendered.includes('..')) {
    throw new Generate3dError(
      `--name rendered ".." in "${rendered}", which would leave the package directory.`
    );
  }
  if (!SAFE_BASE_NAME.test(rendered)) {
    throw new Generate3dError(
      `--name rendered "${rendered}", which is not a valid file name. Use letters, digits, dot, dash, and underscore, starting with a letter or digit.`
    );
  }
  return rendered;
}
