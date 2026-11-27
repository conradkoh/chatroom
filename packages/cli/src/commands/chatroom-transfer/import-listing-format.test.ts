/**
 * Listing presentation and the selection token parser.
 *
 * These are literal checks on purpose: the prompt shows these lines verbatim,
 * so a wording change is a user-visible change and should fail here.
 */

import type {
  ListedEntry,
  TransferListing,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-listing';
import { describe, expect, it } from 'vitest';

import { formatListing, parseSelectTokens } from './import-listing-format.js';

function entry(overrides: Partial<ListedEntry> = {}): ListedEntry {
  return {
    key: 'room-a',
    position: 1,
    name: 'Room A',
    sourceChatroomId: 'room-a',
    teamStructureId: 'trio@1',
    status: 'active',
    exportedAt: '2026-05-01T10:00:00.000Z',
    counts: { messages: 3, tasks: 1, backlog: 2 },
    workingDirCount: 1,
    omittedAttachments: { count: 0, bytes: 0 },
    validity: { ok: true },
    ...overrides,
  };
}

function listing(kind: 'single' | 'bundle', entries: ListedEntry[]): TransferListing {
  return {
    kind,
    exportedAt: '2026-05-01T10:00:00.000Z',
    entries,
    files: new Map(),
  };
}

describe('parseSelectTokens', () => {
  it('recognizes all after trimming', () => {
    expect(parseSelectTokens(' all ')).toBe('all');
  });

  it('splits on commas and drops blank tokens', () => {
    expect(parseSelectTokens('1, 3,abc ,')).toEqual(['1', '3', 'abc']);
  });

  it('returns no tokens for an empty answer', () => {
    expect(parseSelectTokens('')).toEqual([]);
  });
});

describe('formatListing', () => {
  it('prints a bundle header and one numbered block per chatroom', () => {
    const lines = formatListing(
      listing('bundle', [entry(), entry({ key: 'room-b', position: 2 })])
    );

    expect(lines[0]).toBe('Bundle exported 2026-05-01T10:00:00.000Z: 2 chatroom(s)');
    expect(lines).toContain('[1] Room A');
    expect(lines).toContain(
      '  source room-a · team trio@1 · status active · exported 2026-05-01T10:00:00.000Z'
    );
    expect(lines).toContain('  3 messages · 1 tasks · 2 backlog · 1 working dir(s)');
  });

  it('prints the single-file header', () => {
    const lines = formatListing(listing('single', [entry()]));

    expect(lines[0]).toBe('Export of chatroom room-a exported 2026-05-01T10:00:00.000Z');
  });

  it('falls back to Untitled chatroom and shows omitted attachments', () => {
    const lines = formatListing(
      listing('single', [entry({ name: null, omittedAttachments: { count: 2, bytes: 2048 } })])
    );

    expect(lines).toContain('[1] Untitled chatroom');
    expect(lines).toContain('  2 attachment(s) not included (2.0 KiB)');
  });

  it('marks an invalid entry not importable with its code and message', () => {
    const lines = formatListing(
      listing('bundle', [
        entry({
          counts: null,
          workingDirCount: null,
          validity: {
            ok: false,
            code: 'IMPORT_CHECKSUM_MISMATCH',
            message: 'The file content does not match its checksum; it changed after export.',
          },
        }),
      ])
    );

    expect(
      lines.some((line) => line.startsWith('  not importable: IMPORT_CHECKSUM_MISMATCH'))
    ).toBe(true);
    expect(lines).toContain(
      '  not importable: IMPORT_CHECKSUM_MISMATCH — The file content does not match its checksum; it changed after export.'
    );
  });
});
