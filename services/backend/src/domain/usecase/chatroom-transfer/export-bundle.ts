/**
 * Chatroom export bundle — driver.
 *
 * `chatroom export` writes ONE file: a `chatroom-export-bundle` that wraps
 * the unchanged v1 payloads, in the same order as its index. This module is the
 * thin orchestration over `runExport`: no I/O, no Convex imports (the port is
 * the only seam), so the CLI owns the publish and the tests own the timing.
 *
 * ## Rules
 *
 * - One clock read. Every payload's `exportedAt` and the bundle's `exportedAt`
 *   are the same instant, so the file name and the contents agree.
 * - All-or-nothing. A failing chatroom is retried once; if any chatroom still
 *   fails the run throws `EXPORT_ALL_INCOMPLETE` and nothing is returned, so no
 *   partial bundle can be written.
 * - `EXPORT_TOO_LARGE` is never retried: a chatroom over the remaining budget
 *   fails the whole run immediately. The bundle is never split.
 * - Strictly sequential. Each chatroom is exported, measured and appended before
 *   the next one starts; only its payload string and index entry are retained.
 */

import { runExport, type ChatroomExportPort } from './export-driver';
import {
  bundleChecksum,
  BUNDLE_RETRIES_PER_CHATROOM,
  CHATROOM_EXPORT_BUNDLE_FORMAT_VERSION,
  CHATROOM_EXPORT_BUNDLE_KIND,
  ChatroomTransferError,
  EXPORT_MAX_FILE_BYTES,
  TRANSFER_ERROR_CODES,
  type BundleIndexEntry,
  type ChatroomExportFileV1,
} from '../../entities/chatroom-transfer-file';

export interface RunExportBundleArgs {
  /** From `listForMachine`; never empty (the caller handles zero chatrooms). */
  chatroomIds: readonly string[];
  machineId: string | null;
  cliVersion: string;
  /** Read once and reused for every payload, so the whole bundle shares one instant. */
  now: () => Date;
  /** Checked between chatrooms. */
  signal?: AbortSignal;
  onProgress?: (e: { done: number; total: number; chatroomId: string }) => void;
  /** Test seam; production uses `EXPORT_MAX_FILE_BYTES` (256 MiB). */
  limits?: { maxFileBytes?: number };
}

export interface BundleExportResult {
  json: string;
  index: BundleIndexEntry[];
  omittedAttachments: { count: number; bytes: number };
}

interface CollectedPayloads {
  payloads: string[];
  index: BundleIndexEntry[];
  failures: BundleFailure[];
}

interface BundleFailure {
  chatroomId: string;
  code: string;
  message: string;
}

export async function runExportBundle(
  port: ChatroomExportPort,
  args: RunExportBundleArgs
): Promise<BundleExportResult> {
  const maxBytes = args.limits?.maxFileBytes ?? EXPORT_MAX_FILE_BYTES;
  const at = args.now();
  const collected = await collectPayloads(port, args, at, maxBytes);

  throwIfIncomplete(collected.failures, args.chatroomIds.length);
  return assembleBundle(collected, args, at, maxBytes);
}

/** Exports every chatroom in order, keeping the payload strings and the failures. */
async function collectPayloads(
  port: ChatroomExportPort,
  args: RunExportBundleArgs,
  at: Date,
  maxBytes: number
): Promise<CollectedPayloads> {
  const collected: CollectedPayloads = { payloads: [], index: [], failures: [] };
  let payloadBytes = 0;

  for (const [i, chatroomId] of args.chatroomIds.entries()) {
    throwIfAborted(args.signal);
    const outcome = await exportWithRetry(port, {
      chatroomId,
      cliVersion: args.cliVersion,
      at,
      maxBytes: maxBytes - payloadBytes,
    });
    if (outcome.ok) {
      payloadBytes = acceptPayload(collected, outcome.json, outcome.file, payloadBytes);
    } else {
      collected.failures.push({ chatroomId, code: outcome.code, message: outcome.message });
    }
    reportProgress(args.onProgress, { done: i + 1, total: args.chatroomIds.length, chatroomId });
  }
  return collected;
}

/** Appends one accepted payload and returns the new running byte total. */
function acceptPayload(
  collected: CollectedPayloads,
  json: string,
  file: ChatroomExportFileV1,
  payloadBytes: number
): number {
  collected.payloads.push(json);
  collected.index.push(indexEntryOf(file));
  return payloadBytes + new TextEncoder().encode(json).byteLength;
}

function reportProgress(
  onProgress: RunExportBundleArgs['onProgress'],
  event: { done: number; total: number; chatroomId: string }
): void {
  onProgress?.(event);
}

/** The caller's cancellation check; the web maps this message to "cancelled". */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('export aborted');
}

/** Throws the one all-or-nothing error, with one detail line per failed chatroom. */
function throwIfIncomplete(failures: readonly BundleFailure[], total: number): void {
  if (failures.length === 0) return;
  throw new ChatroomTransferError(
    TRANSFER_ERROR_CODES.EXPORT_ALL_INCOMPLETE,
    `exported ${total - failures.length} of ${total} chatrooms; ${failures.length} failed`,
    failures.map((failure) => `${failure.chatroomId}: [${failure.code}] ${failure.message}`)
  );
}

/** Checksums the index, serializes the bundle and enforces the overall byte ceiling. */
async function assembleBundle(
  collected: CollectedPayloads,
  args: RunExportBundleArgs,
  at: Date,
  maxBytes: number
): Promise<BundleExportResult> {
  const checksum = await bundleChecksum({
    formatVersion: CHATROOM_EXPORT_BUNDLE_FORMAT_VERSION,
    kind: CHATROOM_EXPORT_BUNDLE_KIND,
    index: collected.index,
  });
  const json = serializeBundle({
    at,
    args,
    index: collected.index,
    payloads: collected.payloads,
    checksum,
  });
  if (new TextEncoder().encode(json).byteLength > maxBytes) {
    throw new ChatroomTransferError(
      TRANSFER_ERROR_CODES.EXPORT_TOO_LARGE,
      `Export exceeds the ${maxBytes}-byte limit; export fewer chatrooms or remove content and run the export again.`
    );
  }
  return { json, index: collected.index, omittedAttachments: sumOmitted(collected.index) };
}

type ExportOutcome =
  | { ok: true; file: ChatroomExportFileV1; json: string }
  | { ok: false; code: string; message: string };

interface RetryArgs {
  chatroomId: string;
  cliVersion: string;
  at: Date;
  maxBytes: number;
}

/**
 * Runs one chatroom, retrying a failure once. `EXPORT_TOO_LARGE` escapes
 * immediately because retrying cannot shrink the chatroom. Any other error is
 * kept and reported after the second attempt, so the run can collect every
 * failing chatroom before it gives up.
 */
async function exportWithRetry(port: ChatroomExportPort, args: RetryArgs): Promise<ExportOutcome> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= BUNDLE_RETRIES_PER_CHATROOM; attempt += 1) {
    try {
      const { file, json } = await runExport(port, {
        chatroomId: args.chatroomId,
        cliVersion: args.cliVersion,
        now: () => args.at,
        limits: { maxFileBytes: args.maxBytes },
      });
      return { ok: true, file, json };
    } catch (error) {
      if (isTooLarge(error)) throw error;
      lastError = error;
    }
  }
  return { ok: false, code: errorCodeOf(lastError), message: errorMessageOf(lastError) };
}

/** `EXPORT_TOO_LARGE` is the one failure that must not be retried. */
function isTooLarge(error: unknown): boolean {
  return (
    error instanceof ChatroomTransferError && error.code === TRANSFER_ERROR_CODES.EXPORT_TOO_LARGE
  );
}

/** Transfer errors keep their machine-readable code; anything else is `UNKNOWN` for the run. */
function errorCodeOf(error: unknown): string {
  return error instanceof ChatroomTransferError ? error.code : 'UNKNOWN';
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The bundle index entry for one payload. Field reads mirror the v1 row shapes. */
function indexEntryOf(file: ChatroomExportFileV1): BundleIndexEntry {
  return {
    ...indexIdentity(file),
    messageCount: file.messages.length,
    taskCount: file.tasks.length,
    backlogCount: file.backlog.length,
    workingDirs: file.workspaces.map((workspace) => String(workspace.workingDir)),
    omittedAttachments: attachmentTally(file),
    checksum: file.checksum,
  };
}

type IndexIdentity = Pick<
  BundleIndexEntry,
  'sourceChatroomId' | 'name' | 'status' | 'teamStructureId' | 'lastActivityAt'
>;

/** The identity and display fields, with `null` where the row omits them. */
function indexIdentity(file: ChatroomExportFileV1): IndexIdentity {
  return {
    sourceChatroomId: file.source.chatroomId,
    name: stringOrNull(file.room.name),
    status: file.room.status === 'completed' ? 'completed' : 'active',
    teamStructureId: String(file.room.teamStructureId),
    lastActivityAt: numberOrNull(file.room.lastActivityAt),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** The payload's attachment omission as numbers, defaulting to zero. */
function attachmentTally(file: ChatroomExportFileV1): { count: number; bytes: number } {
  const omitted = file.omitted.chatroom_fileAttachments ?? { count: 0, bytes: 0 };
  return { count: omitted.count ?? 0, bytes: omitted.bytes ?? 0 };
}

/** The bundle's own omitted tally: what a person needs to know before importing. */
function sumOmitted(index: readonly BundleIndexEntry[]): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const entry of index) {
    count += entry.omittedAttachments.count;
    bytes += entry.omittedAttachments.bytes;
  }
  return { count, bytes };
}

/**
 * Builds the bundle JSON with the v1 payloads embedded verbatim.
 *
 * The payload strings come from `runExport` and are never re-stringified: a
 * round trip through `JSON.parse`/`JSON.stringify` would reorder keys and break
 * the byte-identical payload a previous export wrote. Property order is fixed
 * (format fields, index, chatrooms, checksum) so the file is readable.
 */
function serializeBundle(input: {
  at: Date;
  args: RunExportBundleArgs;
  index: BundleIndexEntry[];
  payloads: readonly string[];
  checksum: string;
}): string {
  return (
    `{"formatVersion":${CHATROOM_EXPORT_BUNDLE_FORMAT_VERSION}` +
    `,"kind":${JSON.stringify(CHATROOM_EXPORT_BUNDLE_KIND)}` +
    `,"exportedAt":${JSON.stringify(input.at.toISOString())}` +
    `,"source":${JSON.stringify({ machineId: input.args.machineId, cliVersion: input.args.cliVersion })}` +
    `,"index":${JSON.stringify(input.index)}` +
    `,"chatrooms":[${input.payloads.join(',')}]` +
    `,"checksum":${JSON.stringify(input.checksum)}}`
  );
}
