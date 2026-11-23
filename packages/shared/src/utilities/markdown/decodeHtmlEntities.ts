const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
};

/** Highest Unicode code point. A numeric reference above it is not a character. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Decodes the digits of a numeric reference. Returns the literal match when the value
 * is not an integer code point, so the input passes through unchanged instead of throwing.
 */
function decodeNumericReference(match: string, digits: string, radix: number): string {
  const codePoint = parseInt(digits, radix);
  if (!Number.isInteger(codePoint) || codePoint > MAX_CODE_POINT) return match;
  return String.fromCodePoint(codePoint);
}

export function decodeHtmlEntities(input: string, maxPasses = 3): string {
  let result = input;
  for (let pass = 0; pass < maxPasses; pass++) {
    const previous = result;
    result = result.replace(
      /&(?:amp;)?(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
      (match, body: string) => {
        if (body.startsWith('#x') || body.startsWith('#X'))
          return decodeNumericReference(match, body.slice(2), 16);
        if (body.startsWith('#')) return decodeNumericReference(match, body.slice(1), 10);
        return NAMED_ENTITIES[body] ?? match;
      }
    );
    if (result === previous) break;
  }
  return result;
}
