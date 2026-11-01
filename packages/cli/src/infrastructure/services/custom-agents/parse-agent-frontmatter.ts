/**
 * Pure `AGENT.md` frontmatter parser.
 *
 * Splits one custom-agent file into its YAML frontmatter and markdown body. The
 * parser is total: it never throws and reports only two failures,
 * `missing-frontmatter` and `invalid-frontmatter`. Every other rule (name
 * shape, description content, size caps, reserved names) belongs to
 * `validateCustomAgentPayload` in the shared package, so the loader and the
 * backend cannot drift.
 *
 * YAML safety: duplicate keys, anchors, aliases, unresolved (custom) tags, a
 * non-mapping root, and non-string values are all rejected as
 * `invalid-frontmatter`, so a crafted file cannot smuggle structure or node
 * expansion into the loader.
 *
 * Input contract: the text is expected to be BOM-free with LF line endings. The
 * loader's bounded reader normalises it before parsing; this function does no
 * normalisation of its own so the parser stays pure.
 */

import { CUSTOM_AGENT_FORBIDDEN_FRONTMATTER_KEYS } from '@workspace/shared/domain/custom-agent';
import { isMap, isScalar, parseDocument, visit, type Pair } from 'yaml';

/** A frontmatter key the loader refuses to honour but does not reject the agent for. */
export interface FrontmatterFlaggedKey {
  key: string;
  reason: 'forbidden-field' | 'unknown-field';
}

export type FrontmatterResult =
  | {
      ok: true;
      name: string;
      description: string;
      body: string;
      flaggedKeys: FrontmatterFlaggedKey[];
    }
  | { ok: false; reason: 'missing-frontmatter' | 'invalid-frontmatter' };

type FrontmatterFailure = Extract<FrontmatterResult, { ok: false }>;
type ParsedYamlDocument = ReturnType<typeof parseDocument>;

const DELIMITER = '---';
const NAME_KEY = 'name';
const DESCRIPTION_KEY = 'description';

/**
 * Parse the contents of one `AGENT.md`.
 *
 * The first line must be exactly `---` and a later line must be exactly `---`;
 * otherwise the file has no frontmatter block. The body is everything after the
 * closing delimiter, with leading blank lines and trailing whitespace removed.
 */
export function parseAgentFile(text: string): FrontmatterResult {
  const split = splitFrontmatter(text);
  if (split === null) return failure('missing-frontmatter');

  const entries = readFrontmatter(split.frontmatter);
  if (entries === null) return failure('invalid-frontmatter');

  return buildResult(entries, split.body);
}

interface SplitFrontmatter {
  frontmatter: string;
  body: string;
}

function failure(reason: FrontmatterFailure['reason']): FrontmatterFailure {
  return { ok: false, reason };
}

function splitFrontmatter(text: string): SplitFrontmatter | null {
  const lines = text.split('\n');
  if (lines[0] !== DELIMITER) return null;

  const closingIndex = lines.indexOf(DELIMITER, 1);
  if (closingIndex === -1) return null;

  return {
    frontmatter: lines.slice(1, closingIndex).join('\n'),
    body: trimBody(lines.slice(closingIndex + 1).join('\n')),
  };
}

/** Drops leading blank lines and trailing whitespace; interior text stays verbatim. */
function trimBody(body: string): string {
  return body.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

/**
 * Parse the frontmatter block into string entries.
 *
 * Returns null for anything the loader must refuse: YAML parse errors, strict
 * warnings (unresolved tags), duplicate keys, anchors or aliases, a non-mapping
 * root, a non-string key, or a non-string value.
 */
function readFrontmatter(source: string): Map<string, string> | null {
  try {
    const doc = parseDocument(source, { strict: true, uniqueKeys: true });
    if (hasYamlProblem(doc) || hasAnchorOrAlias(doc)) return null;
    return readStringEntries(doc.contents);
  } catch {
    return null;
  }
}

function hasYamlProblem(doc: ParsedYamlDocument): boolean {
  return doc.errors.length > 0 || doc.warnings.length > 0;
}

/** Anchors are rejected even without an alias: they imply structure we do not model. */
function hasAnchorOrAlias(doc: ParsedYamlDocument): boolean {
  let found = false;
  visit(doc, {
    Alias: () => {
      found = true;
    },
    Node: (_key, node) => {
      if (node.anchor !== undefined) found = true;
    },
  });
  return found;
}

function readStringEntries(contents: unknown): Map<string, string> | null {
  if (!isMap(contents)) return null;

  const entries = new Map<string, string>();
  for (const pair of contents.items) {
    const entry = readStringPair(pair);
    if (entry === null) return null;
    entries.set(entry[0], entry[1]);
  }
  return entries;
}

function readStringPair(pair: Pair): [string, string] | null {
  const key = readStringScalar(pair.key);
  const value = readStringScalar(pair.value);
  if (key === null || value === null) return null;
  return [key, value];
}

function readStringScalar(node: unknown): string | null {
  if (!isScalar(node)) return null;
  return typeof node.value === 'string' ? node.value : null;
}

function buildResult(entries: Map<string, string>, body: string): FrontmatterResult {
  const name = entries.get(NAME_KEY);
  const description = entries.get(DESCRIPTION_KEY);
  if (name === undefined || description === undefined) return failure('invalid-frontmatter');

  return {
    ok: true,
    name,
    description,
    body,
    flaggedKeys: classifyKeys([...entries.keys()]),
  };
}

/** Every key other than `name` and `description` is flagged, never honoured. */
function classifyKeys(keys: readonly string[]): FrontmatterFlaggedKey[] {
  return keys.filter(isFlaggedKey).map((key) => ({
    key,
    reason: isForbiddenKey(key) ? 'forbidden-field' : 'unknown-field',
  }));
}

function isFlaggedKey(key: string): boolean {
  return key !== NAME_KEY && key !== DESCRIPTION_KEY;
}

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return CUSTOM_AGENT_FORBIDDEN_FRONTMATTER_KEYS.some(
    (forbidden) => forbidden.toLowerCase() === normalized
  );
}
