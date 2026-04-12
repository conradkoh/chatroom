/**
 * File reference display sync layer.
 *
 * Pure functions for mapping between internal file reference format
 * (`<prefix>{file:<workspace>:<path>}`) and user-visible display format
 * (just the file path).
 *
 * No DOM, no React, no side effects — string-in, string-out.
 */

import { decodeFileReferences } from './fileReference';

// ── Types ──────────────────────────────────────────────────────────────────

/** Describes a token's position in both internal and display text. */
export interface TokenMapping {
  /** Start index (inclusive) in internal text. */
  internalStart: number;
  /** End index (exclusive) in internal text. */
  internalEnd: number;
  /** Start index (inclusive) in display text. */
  displayStart: number;
  /** End index (exclusive) in display text. */
  displayEnd: number;
  /** The display text (file path). */
  filePath: string;
  /** The full internal token string. */
  fullToken: string;
}

// ── Core Functions ─────────────────────────────────────────────────────────

/**
 * Convert internal text (with file reference tokens) to display text
 * (with just file paths).
 */
export function internalToDisplay(text: string, prefix: string): string {
  if (!text) return text;

  const refs = decodeFileReferences(text, prefix);
  if (refs.length === 0) return text;

  let result = '';
  let cursor = 0;

  for (const ref of refs) {
    result += text.slice(cursor, ref.start);
    result += ref.filePath;
    cursor = ref.end;
  }

  result += text.slice(cursor);
  return result;
}

/**
 * Build a mapping of token positions between internal and display text.
 * This is the core data structure enabling cursor/offset translation.
 */
export function buildTokenMap(text: string, prefix: string): TokenMapping[] {
  if (!text) return [];

  const refs = decodeFileReferences(text, prefix);
  if (refs.length === 0) return [];

  const mappings: TokenMapping[] = [];
  let displayOffset = 0; // cumulative shift from internal to display coordinates

  for (const ref of refs) {
    const fullToken = text.slice(ref.start, ref.end);
    const tokenLength = ref.end - ref.start;
    const displayLength = ref.filePath.length;

    mappings.push({
      internalStart: ref.start,
      internalEnd: ref.end,
      displayStart: ref.start + displayOffset,
      displayEnd: ref.start + displayOffset + displayLength,
      filePath: ref.filePath,
      fullToken,
    });

    displayOffset += displayLength - tokenLength;
  }

  return mappings;
}

/**
 * Map a cursor position from internal text coordinates to display text coordinates.
 * If the cursor falls inside a token, it is clamped to the nearest display edge.
 */
export function internalOffsetToDisplay(offset: number, tokenMap: TokenMapping[]): number {
  let shift = 0;

  for (const mapping of tokenMap) {
    if (offset < mapping.internalStart) {
      // Cursor is before this token
      break;
    }

    if (offset >= mapping.internalStart && offset < mapping.internalEnd) {
      // Cursor is inside the token — clamp to nearest display edge
      const tokenMidpoint = (mapping.internalStart + mapping.internalEnd) / 2;
      if (offset < tokenMidpoint) {
        return mapping.displayStart;
      } else {
        return mapping.displayEnd;
      }
    }

    // Cursor is at or after this token's end
    shift += mapping.filePath.length - mapping.fullToken.length;
  }

  return offset + shift;
}

/**
 * Map a cursor position from display text coordinates to internal text coordinates.
 * If the cursor falls inside a display token (file path), it maps to the internal token start.
 */
export function displayOffsetToInternal(offset: number, tokenMap: TokenMapping[]): number {
  let shift = 0;

  for (const mapping of tokenMap) {
    if (offset < mapping.displayStart) {
      break;
    }

    if (offset >= mapping.displayStart && offset < mapping.displayEnd) {
      // Cursor is inside the display file path — map to internal token start
      return mapping.internalStart;
    }

    if (offset >= mapping.displayEnd) {
      // At or past this token's display end — map to corresponding internal position
      shift += mapping.fullToken.length - mapping.filePath.length;
    }
  }

  return offset + shift;
}

/**
 * Given the current internal text and the new display text after a user edit,
 * reconstruct the new internal text.
 *
 * Strategy: walk through the old display text and new display text simultaneously,
 * using the token map to preserve or remove internal tokens as appropriate.
 */
export function applyDisplayEdit(
  internalText: string,
  prefix: string,
  displayText: string
): string {
  if (!internalText) return displayText;

  const oldDisplay = internalToDisplay(internalText, prefix);
  if (oldDisplay === displayText) return internalText;

  const tokenMap = buildTokenMap(internalText, prefix);
  if (tokenMap.length === 0) {
    // No tokens — display text IS the internal text
    return displayText;
  }

  // Find the changed region by comparing old and new display text
  let commonPrefixLen = 0;
  const minLen = Math.min(oldDisplay.length, displayText.length);
  while (commonPrefixLen < minLen && oldDisplay[commonPrefixLen] === displayText[commonPrefixLen]) {
    commonPrefixLen++;
  }

  let commonSuffixLen = 0;
  while (
    commonSuffixLen < minLen - commonPrefixLen &&
    oldDisplay[oldDisplay.length - 1 - commonSuffixLen] ===
      displayText[displayText.length - 1 - commonSuffixLen]
  ) {
    commonSuffixLen++;
  }

  let oldChangeStart = commonPrefixLen;
  let oldChangeEnd = oldDisplay.length - commonSuffixLen;
  let newChangeStart = commonPrefixLen;
  let newChangeEnd = displayText.length - commonSuffixLen;

  // Expand the change region to include any partially-overlapping tokens.
  // If the edit boundary falls inside a display token, we must include
  // the entire token in the affected region.
  for (const mapping of tokenMap) {
    // Token overlaps the change region?
    if (mapping.displayStart < oldChangeEnd && mapping.displayEnd > oldChangeStart) {
      if (mapping.displayStart < oldChangeStart) {
        // Token starts before the change — expand leftward
        const expansion = oldChangeStart - mapping.displayStart;
        oldChangeStart = mapping.displayStart;
        newChangeStart -= expansion;
      }
      if (mapping.displayEnd > oldChangeEnd) {
        // Token ends after the change — expand rightward
        const expansion = mapping.displayEnd - oldChangeEnd;
        oldChangeEnd = mapping.displayEnd;
        newChangeEnd += expansion;
      }
    }
  }

  const newInsertedText = displayText.slice(newChangeStart, newChangeEnd);

  // Map the (now token-aligned) display boundaries to internal coordinates
  const internalChangeStart = displayOffsetToInternalBoundary(oldChangeStart, tokenMap);
  const internalChangeEnd = displayOffsetToInternalBoundary(oldChangeEnd, tokenMap);

  return internalText.slice(0, internalChangeStart) + newInsertedText + internalText.slice(internalChangeEnd);
}

/**
 * Map a display offset to internal offset at a token boundary.
 * After expanding the change region to cover full tokens, the offset
 * should be at a token boundary or in a non-token region.
 */
function displayOffsetToInternalBoundary(
  displayOffset: number,
  tokenMap: TokenMapping[]
): number {
  let shift = 0;

  for (const mapping of tokenMap) {
    if (displayOffset <= mapping.displayStart) {
      break;
    }

    if (displayOffset >= mapping.displayEnd) {
      shift += mapping.fullToken.length - mapping.filePath.length;
    } else if (displayOffset === mapping.displayStart) {
      break;
    }
  }

  return displayOffset + shift;
}
