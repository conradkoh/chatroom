/**
 * Chatroom import — offline listing and selection.
 *
 * Reads a v1 export file or a v1 bundle without a session, a network call or a
 * machine id (D5). It answers three questions before anything is written:
 *
 * 1. Is this the right kind and version? (one whole-file refusal)
 * 2. Which chatrooms does the file contain, and which are importable? (a bad
 *    payload is listed, not refused, so one tampered entry does not hide the
 *    rest)
 * 3. Which of those did the user choose? (`selectEntries`)
 *
 * No I/O and no Convex imports. The CLI reads the bytes and calls
 * `parseTransferFile`; the browser (P6) will call the same function.
 *
 * ## Refusal order (fixed, first problem wins)
 *
 * JSON parse → `kind` → `formatVersion` → (single) payload validation, or
 * (bundle) index shape → bundle checksum → per-entry payload validation.
 * A single v1 file is refused as a whole, exactly as `runImport` does; a bundle
 * entry only marks itself `not importable`.
 */

import { isPlainObject, validateExportValue, type ImportFailure } from './import-plan';
import {
  bundleChecksum,
  CHATROOM_EXPORT_BUNDLE_FORMAT_VERSION,
  CHATROOM_EXPORT_BUNDLE_KIND,
  CHATROOM_EXPORT_FORMAT_VERSION,
  CHATROOM_EXPORT_KIND,
  EXPORT_MAX_FILE_BYTES,
  TRANSFER_ERROR_CODES,
  type BundleIndexEntry,
  type ChatroomExportFileV1,
  type TransferErrorCode,
} from '../../entities/chatroom-transfer-file';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One chatroom the file offers for import. Display fields are `null` when absent. */
export interface ListedEntry {
  /** `sourceChatroomId`; the key the import is selected and reported by. */
  key: string;
  /** 1-based; the number the CLI prompt shows. */
  position: number;
  name: string | null;
  sourceChatroomId: string;
  teamStructureId: string | null;
  status: 'active' | 'completed' | null;
  exportedAt: string;
  counts: { messages: number; tasks: number; backlog: number } | null;
  workingDirCount: number | null;
  omittedAttachments: { count: number; bytes: number | null };
  validity: { ok: true } | { ok: false; code: TransferErrorCode; message: string };
}

export interface TransferListing {
  kind: 'single' | 'bundle';
  exportedAt: string;
  entries: ListedEntry[];
  /** Validated v1 payloads by entry key, for valid entries only. */
  files: ReadonlyMap<string, ChatroomExportFileV1>;
}

export type TransferParseResult = { ok: true; listing: TransferListing } | ImportFailure;

export interface ParseTransferOptions {
  onProgress?: (done: number, total: number) => void;
}

// ---------------------------------------------------------------------------
// Size gate
// ---------------------------------------------------------------------------

/** Checked against `stat` before the file is read. Returns a refusal or null. */
export function checkTransferFileSize(sizeBytes: number): ImportFailure | null {
  if (sizeBytes <= EXPORT_MAX_FILE_BYTES) return null;
  return {
    ok: false,
    code: TRANSFER_ERROR_CODES.IMPORT_FILE_TOO_LARGE,
    message: `file is larger than ${EXPORT_MAX_FILE_BYTES} bytes`,
    details: [],
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export async function parseTransferFile(
  text: string,
  opts: ParseTransferOptions = {}
): Promise<TransferParseResult> {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return await parseValue(parsed.value, opts);
}

/** Kind dispatch after the text parsed; a single file and a bundle diverge here. */
async function parseValue(
  value: unknown,
  opts: ParseTransferOptions
): Promise<TransferParseResult> {
  if (!isPlainObject(value)) return notAnExport();
  if (value.kind === CHATROOM_EXPORT_KIND) return await parseSingle(value);
  if (value.kind === CHATROOM_EXPORT_BUNDLE_KIND) return await parseBundle(value, opts);
  return notAnExport();
}

async function parseSingle(value: Record<string, unknown>): Promise<TransferParseResult> {
  const versionFailure = unsupportedVersion(value.formatVersion);
  if (versionFailure) return versionFailure;

  const validation = await validateExportValue(value);
  if (!validation.ok) return validation;

  const file = validation.file;
  const entry = entryFromPayload(file, 1, file.source.chatroomId);
  return {
    ok: true,
    listing: {
      kind: 'single',
      exportedAt: file.exportedAt,
      entries: [entry],
      files: new Map([[entry.key, file]]),
    },
  };
}

interface BundleShape {
  /** Validated just enough to checksum: plain objects with unique non-empty ids. */
  index: BundleIndexEntry[];
  chatrooms: unknown[];
}

async function parseBundle(
  value: Record<string, unknown>,
  opts: ParseTransferOptions
): Promise<TransferParseResult> {
  const versionFailure = unsupportedVersion(value.formatVersion);
  if (versionFailure) return versionFailure;

  const shape = bundleShape(value);
  if (!shape.ok) return shape;

  const checksumFailure = await bundleChecksumFailure(value.checksum, shape.index);
  if (checksumFailure !== null) return checksumFailure;
  return await bundleListing(value, shape, opts);
}

/** The index is the only checksummed part; a changed payload is caught per entry. */
async function bundleChecksumFailure(
  checksum: unknown,
  index: BundleIndexEntry[]
): Promise<ImportFailure | null> {
  const expected = await bundleChecksum({
    formatVersion: CHATROOM_EXPORT_BUNDLE_FORMAT_VERSION,
    kind: CHATROOM_EXPORT_BUNDLE_KIND,
    index,
  });
  if (expected === checksum) return null;
  return failure(
    TRANSFER_ERROR_CODES.IMPORT_CHECKSUM_MISMATCH,
    'The bundle index does not match its checksum; the file changed after export.'
  );
}

async function bundleListing(
  value: Record<string, unknown>,
  shape: BundleShape,
  opts: ParseTransferOptions
): Promise<TransferParseResult> {
  const exportedAt = typeof value.exportedAt === 'string' ? value.exportedAt : '';
  const parsed = await parseBundleEntries(shape, exportedAt, opts);
  return { ok: true, listing: { kind: 'bundle', exportedAt, ...parsed } };
}

interface ParsedBundle {
  entries: ListedEntry[];
  files: Map<string, ChatroomExportFileV1>;
}

/**
 * Validates one payload at a time, in bundle order. A failed payload keeps the
 * file importable for the others: its entry carries the failure and no file
 * mapping. The `setTimeout` is a paint yield, not a retry.
 */
async function parseBundleEntries(
  shape: BundleShape,
  exportedAt: string,
  opts: ParseTransferOptions
): Promise<ParsedBundle> {
  const entries: ListedEntry[] = [];
  const files = new Map<string, ChatroomExportFileV1>();
  const total = shape.index.length;

  for (const [i, indexEntry] of shape.index.entries()) {
    const position = i + 1;
    const sourceChatroomId = String(indexEntry.sourceChatroomId);
    const entry = await bundleEntry(
      shape.chatrooms[i],
      indexEntry,
      position,
      sourceChatroomId,
      exportedAt
    );
    entries.push(entry);
    if (entry.validity.ok) files.set(entry.key, shape.chatrooms[i] as ChatroomExportFileV1);

    opts.onProgress?.(position, total);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { entries, files };
}

/** One bundle entry: a valid payload, or an entry explaining why it is not importable. */
async function bundleEntry(
  payload: unknown,
  indexEntry: BundleIndexEntry,
  position: number,
  key: string,
  exportedAt: string
): Promise<ListedEntry> {
  const validation = await validateExportValue(payload);
  if (!validation.ok) {
    return entryFromIndex(
      indexEntry,
      position,
      key,
      exportedAt,
      validation.code,
      validation.message
    );
  }

  const file = validation.file;
  const pairingFailure = payloadPairing(file, indexEntry);
  if (pairingFailure) {
    return entryFromIndex(
      indexEntry,
      position,
      key,
      exportedAt,
      pairingFailure.code,
      pairingFailure.message
    );
  }
  return entryFromPayload(file, position, key);
}

/** The payload must be the one the index describes: same checksum and same source id. */
function payloadPairing(
  file: ChatroomExportFileV1,
  indexEntry: BundleIndexEntry
): ImportFailure | undefined {
  if (file.checksum !== indexEntry.checksum) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_CHECKSUM_MISMATCH,
      'The file content does not match its checksum; it changed after export.'
    );
  }
  if (file.source.chatroomId !== indexEntry.sourceChatroomId) {
    return failure(
      TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
      'The file is not a readable chatroom export.'
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Entry construction
// ---------------------------------------------------------------------------

function entryFromPayload(file: ChatroomExportFileV1, position: number, key: string): ListedEntry {
  const room = file.room;
  return {
    key,
    position,
    name: stringOrNull(room.name),
    sourceChatroomId: file.source.chatroomId,
    teamStructureId: String(room.teamStructureId),
    status: statusOf(room.status) ?? 'active',
    exportedAt: file.exportedAt,
    counts: payloadCounts(file),
    workingDirCount: file.workspaces.length,
    omittedAttachments: payloadOmitted(file),
    validity: { ok: true },
  };
}

function payloadCounts(file: ChatroomExportFileV1): NonNullable<ListedEntry['counts']> {
  return {
    messages: file.messages.length,
    tasks: file.tasks.length,
    backlog: file.backlog.length,
  };
}

function payloadOmitted(file: ChatroomExportFileV1): { count: number; bytes: number } {
  const omitted = file.omitted.chatroom_fileAttachments;
  if (omitted === undefined) return { count: 0, bytes: 0 };
  return { count: numberOrZero(omitted.count), bytes: numberOrZero(omitted.bytes) };
}

function numberOrZero(value: number | null | undefined): number {
  return value ?? 0;
}

/** Details for an unreadable payload come from the index; anything unusable is `null`. */
function entryFromIndex(
  indexEntry: BundleIndexEntry,
  position: number,
  key: string,
  exportedAt: string,
  code: TransferErrorCode,
  message: string
): ListedEntry {
  return {
    key,
    position,
    name: stringOrNull(indexEntry.name),
    sourceChatroomId: key,
    teamStructureId: stringOrNull(indexEntry.teamStructureId),
    status: statusOf(indexEntry.status),
    exportedAt,
    counts: countsOf(indexEntry),
    workingDirCount: Array.isArray(indexEntry.workingDirs) ? indexEntry.workingDirs.length : null,
    omittedAttachments: omittedOf(indexEntry.omittedAttachments),
    validity: { ok: false, code, message },
  };
}

function countsOf(indexEntry: BundleIndexEntry): ListedEntry['counts'] {
  const messages = indexEntry.messageCount;
  const tasks = indexEntry.taskCount;
  const backlog = indexEntry.backlogCount;
  if (typeof messages !== 'number' || typeof tasks !== 'number' || typeof backlog !== 'number') {
    return null;
  }
  return { messages, tasks, backlog };
}

function omittedOf(value: unknown): { count: number; bytes: number | null } {
  if (!isPlainObject(value) || typeof value.count !== 'number') return { count: 0, bytes: null };
  return { count: value.count, bytes: typeof value.bytes === 'number' ? value.bytes : null };
}

function statusOf(value: unknown): 'active' | 'completed' | null {
  return value === 'active' || value === 'completed' ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ---------------------------------------------------------------------------
// Bundle shape
// ---------------------------------------------------------------------------

type BundleShapeResult = ({ ok: true } & BundleShape) | ImportFailure;

function bundleShape(value: Record<string, unknown>): BundleShapeResult {
  const index = value.index;
  const chatrooms = value.chatrooms;
  if (!arePairedArrays(index, chatrooms)) return unreadableBundle();

  const entries = index as BundleIndexEntry[];
  if (!entries.every(hasIndexId)) return unreadableBundle();
  if (!hasUniqueIds(entries)) return unreadableBundle();
  return { ok: true, index: entries, chatrooms: chatrooms as unknown[] };
}

function arePairedArrays(index: unknown, chatrooms: unknown): boolean {
  return Array.isArray(index) && Array.isArray(chatrooms) && index.length === chatrooms.length;
}

/** Shape only: an index entry needs a non-empty id to be addressable. */
function hasIndexId(entry: unknown): boolean {
  return (
    isPlainObject(entry) &&
    typeof entry.sourceChatroomId === 'string' &&
    entry.sourceChatroomId.length > 0
  );
}

function hasUniqueIds(entries: readonly BundleIndexEntry[]): boolean {
  return new Set(entries.map((entry) => entry.sourceChatroomId)).size === entries.length;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Resolves tokens to entry keys. A token matching an id wins over a position;
 * `'all'` takes every importable entry and silently skips the rest. Anything
 * else is reported together, so the user fixes one typo run at a time.
 */
export function selectEntries(
  listing: TransferListing,
  keysOrPositions: readonly string[] | 'all'
): { ok: true; keys: string[] } | ImportFailure {
  if (keysOrPositions === 'all') {
    return { ok: true, keys: importableKeys(listing) };
  }

  const resolved = keysOrPositions
    .map((raw) => raw.trim())
    .filter((token) => token.length > 0)
    .map((token) => ({ token, entry: findEntry(listing.entries, token) }));

  const bad = resolved
    .filter(({ entry }) => entry === undefined || !entry.validity.ok)
    .map(({ token }) => token);
  if (bad.length > 0) return selectionFailure(bad);
  return { ok: true, keys: uniqueKeys(resolved) };
}

function importableKeys(listing: TransferListing): string[] {
  return listing.entries.filter((entry) => entry.validity.ok).map((entry) => entry.key);
}

interface ResolvedToken {
  token: string;
  entry: ListedEntry | undefined;
}

/** Deduplicated in first-occurrence order. */
function uniqueKeys(resolved: readonly ResolvedToken[]): string[] {
  const keys: string[] = [];
  for (const { entry } of resolved) {
    if (entry !== undefined && !keys.includes(entry.key)) keys.push(entry.key);
  }
  return keys;
}

function selectionFailure(bad: string[]): ImportFailure {
  return failure(
    TRANSFER_ERROR_CODES.IMPORT_SELECTION_INVALID,
    `Unknown or not importable chatroom selection: ${bad.join(', ')}`,
    bad
  );
}

function findEntry(entries: readonly ListedEntry[], token: string): ListedEntry | undefined {
  const byId = entries.find((entry) => entry.sourceChatroomId === token);
  if (byId !== undefined) return byId;
  if (!/^\d+$/.test(token)) return undefined;
  return entries.find((entry) => entry.position === Number(token));
}

// ---------------------------------------------------------------------------
// Failures and tiny helpers
// ---------------------------------------------------------------------------

function parseJson(text: string): { ok: true; value: unknown } | ImportFailure {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return failure(TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE, 'The file is not valid JSON.');
  }
}

function unsupportedVersion(version: unknown): ImportFailure | null {
  if (version === CHATROOM_EXPORT_FORMAT_VERSION) return null;
  return failure(
    TRANSFER_ERROR_CODES.IMPORT_UNSUPPORTED_VERSION,
    `This export file has format version ${String(version)}; this app reads version ${CHATROOM_EXPORT_FORMAT_VERSION}.`
  );
}

function notAnExport(): ImportFailure {
  return failure(TRANSFER_ERROR_CODES.IMPORT_NOT_AN_EXPORT, 'This file is not a chatroom export.');
}

function unreadableBundle(): ImportFailure {
  return failure(
    TRANSFER_ERROR_CODES.IMPORT_FILE_UNREADABLE,
    'The file is not a readable chatroom export bundle.'
  );
}

function failure(code: TransferErrorCode, message: string, details: string[] = []): ImportFailure {
  return { ok: false, code, message, details };
}
