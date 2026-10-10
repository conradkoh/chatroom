// TODO(external-skills): remove this suppression once list/activate import this module.
// fallow-ignore-file unused-file
/**
 * Pure SKILL.md parser.
 *
 * Splits a SKILL.md file into YAML frontmatter and markdown body and validates
 * the frontmatter fields required by the Agent Skills spec.
 *
 * Never throws. All failures are returned as `{ ok: false, reason }`.
 * Name-vs-directory matching is NOT done here; it happens in discovery.
 */
import { parse } from 'yaml';

/** Spec name: lowercase alphanumerics separated by single hyphens. */
// TODO(external-skills): remove this suppression once list/activate import this module.
// fallow-ignore-next-line unused-export
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const FRONTMATTER_DELIMITER = '---';
const CLOSING_DELIMITER_PATTERN = /^---\s*$/;

export type ParseSkillFileResult =
  | { ok: true; name: string; description: string; body: string }
  | {
      ok: false;
      reason:
        'missing-frontmatter' | 'invalid-frontmatter' | 'invalid-name' | 'invalid-description';
      detail?: string;
    };

type ParseFailure = Extract<ParseSkillFileResult, { ok: false }>;

/** Build a failure, omitting `detail` entirely when absent (exactOptionalPropertyTypes). */
function fail(reason: ParseFailure['reason'], detail?: string): ParseFailure {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

/**
 * Parse the contents of a SKILL.md file.
 *
 * Constraints:
 * - A leading BOM is stripped and CRLF is normalized to LF before parsing.
 * - The file must open with a `---` line and contain a closing `---` line.
 * - Unknown frontmatter keys (`hidden`, `allowed-tools`, `metadata`, ...) are ignored, not rejected.
 * - The body is returned verbatim, except that leading blank lines are trimmed.
 */
// TODO(external-skills): remove this suppression once list/activate import this module.
// fallow-ignore-next-line unused-export
export function parseSkillFile(content: string): ParseSkillFileResult {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n');

  const split = splitFrontmatter(normalized);
  if (!split.ok) return fail('missing-frontmatter', split.detail);

  const yaml = parseYaml(split.frontmatterText);
  if (!yaml.ok) return fail('invalid-frontmatter', yaml.detail);

  return validateFields(yaml.value, split.body);
}

type SplitResult =
  { ok: true; frontmatterText: string; body: string } | { ok: false; detail?: string };

/** Split normalized content into frontmatter text and body at the closing `---` line. */
function splitFrontmatter(normalized: string): SplitResult {
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) return { ok: false };

  const lines = normalized.split('\n');
  // Search from line 1: line 0 is the opening delimiter.
  const closingIndex = lines.findIndex((line, i) => i > 0 && CLOSING_DELIMITER_PATTERN.test(line));
  if (closingIndex === -1) return { ok: false, detail: 'unclosed frontmatter' };

  return {
    ok: true,
    frontmatterText: lines.slice(1, closingIndex).join('\n'),
    // Trim leading blank lines only; everything after them is preserved verbatim.
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .replace(/^\s*\n/, ''),
  };
}

type YamlResult = { ok: true; value: unknown } | { ok: false; detail: string };

/** Parse YAML, reporting only the first line of any syntax error. */
function parseYaml(text: string): YamlResult {
  try {
    return { ok: true, value: parse(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: message.split('\n')[0] ?? message };
  }
}

/** Validate the parsed frontmatter value against the spec's required fields. */
function validateFields(data: unknown, body: string): ParseSkillFileResult {
  if (!isPlainObject(data)) return fail('invalid-frontmatter', 'frontmatter is not a mapping');

  const name = data.name;
  if (!isValidName(name)) return fail('invalid-name');

  const description = normalizeDescription(data.description);
  if (description === undefined) return fail('invalid-description');

  return { ok: true, name, description, body };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidName(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_NAME_LENGTH && SKILL_NAME_PATTERN.test(value)
  );
}

/** Returns the trimmed description, or undefined when it is not a 1..1024 character string. */
function normalizeDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_DESCRIPTION_LENGTH ? trimmed : undefined;
}
