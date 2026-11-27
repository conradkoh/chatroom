/**
 * CLI presentation for a parsed export file.
 *
 * `formatListing` is one header plus one block per chatroom; the numbering is
 * the same `position` the prompt accepts. `parseSelectTokens` turns the answer
 * into entry tokens without deciding whether they exist — `selectEntries` owns
 * that.
 */

import type {
  ListedEntry,
  TransferListing,
} from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-listing';

import { formatBytes } from './format-bytes.js';

/** One block of lines per entry, plus a header. Presentation only. */
export function formatListing(listing: TransferListing): string[] {
  return [header(listing), ...listing.entries.flatMap(formatEntry)];
}

function header(listing: TransferListing): string {
  if (listing.kind === 'bundle') {
    return `Bundle exported ${listing.exportedAt}: ${listing.entries.length} chatroom(s)`;
  }
  const source = listing.entries[0]?.sourceChatroomId ?? '';
  return `Export of chatroom ${source} exported ${listing.exportedAt}`;
}

function formatEntry(entry: ListedEntry): string[] {
  return [
    `[${entry.position}] ${entry.name ?? 'Untitled chatroom'}`,
    sourceLine(entry),
    ...detailLines(entry),
    ...invalidLines(entry),
  ];
}

function sourceLine(entry: ListedEntry): string {
  return `  source ${entry.sourceChatroomId} · team ${entry.teamStructureId ?? '—'} · status ${entry.status ?? '—'} · exported ${entry.exportedAt}`;
}

function detailLines(entry: ListedEntry): string[] {
  return [...countsLine(entry), ...attachmentsLine(entry)];
}

function countsLine(entry: ListedEntry): string[] {
  if (entry.counts === null) return [];
  return [
    `  ${entry.counts.messages} messages · ${entry.counts.tasks} tasks · ${entry.counts.backlog} backlog · ${entry.workingDirCount ?? 0} working dir(s)`,
  ];
}

function attachmentsLine(entry: ListedEntry): string[] {
  const { count, bytes } = entry.omittedAttachments;
  if (count === 0) return [];
  return [`  ${count} attachment(s) not included (${formatBytes(bytes ?? 0)})`];
}

function invalidLines(entry: ListedEntry): string[] {
  if (entry.validity.ok) return [];
  return [`  not importable: ${entry.validity.code} — ${entry.validity.message}`];
}

/** `all` → `'all'`; otherwise the trimmed non-empty comma-separated tokens. */
export function parseSelectTokens(raw: string): string[] | 'all' {
  if (raw.trim() === 'all') return 'all';
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}
