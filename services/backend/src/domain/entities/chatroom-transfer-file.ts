/**
 * Chatroom export/import file format (pure module).
 *
 * This module owns the on-disk shape, the canonical JSON encoding, the checksum
 * and the transfer error-code vocabulary. It has no Convex imports so the CLI and
 * the backend can share it.
 *
 * ## Checksum
 *
 * `checksum` is the lowercase hex SHA-256 of `canonicalJson(contentOf(file))`.
 * `contentOf` picks exactly the twelve content properties, so adding metadata
 * (`source`, `exportedAt`, `omitted`, `checksum` itself) never changes the digest.
 * Canonical JSON sorts object keys, emits no whitespace, drops `undefined` object
 * properties and writes `undefined` array items as `null` — matching
 * `JSON.stringify`, so a round trip through the file is stable.
 */

export const CHATROOM_EXPORT_FORMAT_VERSION = 1 as const;
export const CHATROOM_EXPORT_KIND = 'chatroom-export' as const;

export type ExportCategory =
  | 'room'
  | 'workspaces'
  | 'agentConfigs'
  | 'messages'
  | 'messageQueue'
  | 'tasks'
  | 'backlog'
  | 'artifacts'
  | 'contexts'
  | 'scheduledPrompts'
  | 'savedCommands'
  | 'skillCustomizations';

/** One row. `_key` is an ordinal ("m12"); `_creationTime` is informational and never restored. Reference fields hold keys. */
export type ExportRow = { _key: string; _creationTime: number } & Record<string, unknown>;

/** The 12 content properties. This object shape is the checksum input. */
export interface ChatroomExportContent {
  room: ExportRow;
  workspaces: ExportRow[];
  agentConfigs: ExportRow[];
  messages: ExportRow[];
  messageQueue: ExportRow[];
  tasks: ExportRow[];
  backlog: ExportRow[];
  artifacts: ExportRow[];
  contexts: ExportRow[];
  scheduledPrompts: ExportRow[];
  savedCommands: ExportRow[];
  skillCustomizations: ExportRow[];
}

export interface ChatroomExportFileV1 extends ChatroomExportContent {
  formatVersion: 1;
  kind: 'chatroom-export';
  exportedAt: string; // ISO-8601
  source: { chatroomId: string; cliVersion: string };
  /** `bytes` is set only for the attachment omission, which is counted and measured. */
  omitted: Record<string, { count: number | null; reason: string; bytes?: number }>;
  checksum: string; // lowercase hex SHA-256 of canonicalJson(contentOf(file))
}

/** Picks exactly the 12 content properties. `omitted`, `source`, `exportedAt`, `checksum` are excluded. */
export function contentOf(file: ChatroomExportContent): ChatroomExportContent {
  return {
    room: file.room,
    workspaces: file.workspaces,
    agentConfigs: file.agentConfigs,
    messages: file.messages,
    messageQueue: file.messageQueue,
    tasks: file.tasks,
    backlog: file.backlog,
    artifacts: file.artifacts,
    contexts: file.contexts,
    scheduledPrompts: file.scheduledPrompts,
    savedCommands: file.savedCommands,
    skillCustomizations: file.skillCustomizations,
  };
}

/**
 * Canonical JSON: object keys sorted (default code-unit order), no whitespace, `undefined`
 * object properties dropped, `undefined` array items written as null (as JSON.stringify does).
 * Throws on NaN, ±Infinity, and any non-plain object (class instances, Date, Map, …).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

type CanonicalHandler = (value: unknown) => unknown;

/** Per-type dispatch keeps `canonicalize` small enough for the complexity gate. */
const CANONICAL_HANDLERS: Record<string, CanonicalHandler> = {
  string: (value) => value,
  boolean: (value) => value,
  number: (value) => canonicalNumber(value as number),
  object: (value) =>
    Array.isArray(value) ? canonicalArray(value) : canonicalObject(value as object),
  undefined: () => undefined,
};

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  const handler = CANONICAL_HANDLERS[typeof value];
  if (!handler) throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  return handler(value);
}

function canonicalNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
  return value;
}

function canonicalArray(value: unknown[]): unknown[] {
  return value.map((item) => canonicalize(item) ?? null);
}

function canonicalObject(value: object): Record<string, unknown> {
  assertPlainObject(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const c = canonicalize((value as Record<string, unknown>)[key]);
    if (c !== undefined) out[key] = c;
  }
  return out;
}

function assertPlainObject(value: object): void {
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('canonicalJson: non-plain object');
  }
}

/** Lowercase hex SHA-256 via the Web Crypto API (Node >= 20 and the Convex edge runtime). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Bundle format (`chatroom export --all`).
 *
 * A bundle wraps the unchanged v1 payloads as JSON strings: `chatrooms` is the
 * same `ChatroomExportFileV1` objects, in `index` order. The index pairs the
 * display fields a person scans with the payload's own v1 `checksum`, so import
 * can detect a payload that was swapped after the bundle was written.
 *
 * The bundle checksum covers `formatVersion`, `kind` and `index` only.
 * `exportedAt` and `source` are display metadata, exactly like the v1 rule, so
 * re-exporting an unchanged machine at another instant yields the same digest.
 */
export const CHATROOM_EXPORT_BUNDLE_KIND = 'chatroom-export-bundle' as const;
export const CHATROOM_EXPORT_BUNDLE_FORMAT_VERSION = 1 as const;
/** One retry per failed chatroom in a bundle (`export --all`). `EXPORT_TOO_LARGE` is never retried. */
export const BUNDLE_RETRIES_PER_CHATROOM = 1;

/** Printed once by every command that writes a file with conversation content. */
export const PLAINTEXT_EXPORT_WARNING =
  'warning: this file is plaintext and contains conversation content. Keep it private.';

/** What the bundle says about one wrapped chatroom. `checksum` is the payload's own v1 checksum. */
export interface BundleIndexEntry {
  sourceChatroomId: string;
  name: string | null;
  status: 'active' | 'completed';
  teamStructureId: string;
  lastActivityAt: number | null;
  messageCount: number;
  taskCount: number;
  backlogCount: number;
  workingDirs: string[];
  omittedAttachments: { count: number; bytes: number };
  /** Equal to the payload's own v1 `checksum`. */
  checksum: string;
}

export interface ChatroomExportBundleV1 {
  formatVersion: 1;
  kind: 'chatroom-export-bundle';
  exportedAt: string; // ISO-8601, display only
  source: { machineId: string | null; cliVersion: string }; // informational, never read on import
  index: BundleIndexEntry[];
  chatrooms: ChatroomExportFileV1[]; // same order as index
  checksum: string; // sha256Hex(canonicalJson({ formatVersion, kind, index }))
}

/** Checksum over the bundle's format fields and index only. */
export async function bundleChecksum(
  b: Pick<ChatroomExportBundleV1, 'formatVersion' | 'kind' | 'index'>
): Promise<string> {
  return sha256Hex(canonicalJson({ formatVersion: b.formatVersion, kind: b.kind, index: b.index }));
}

export const IMPORT_CHUNK_MAX_ROWS = 200;
export const IMPORT_CHUNK_MAX_BYTES = 1_500_000;
export const IMPORT_ROLLBACK_BUDGET = 300;
export const IMPORT_WINDOW_MS = 86_400_000;
export const EXPORT_PAGE_MAX_ROWS = 200;
export const EXPORT_PAGE_MAX_BYTES = 4_194_304;
export const EXPORT_MAX_FILE_BYTES = 268_435_456;

/** Every transfer error code. Server-thrown codes are also registered in `services/backend/config/errorCodes.ts`. */
export const TRANSFER_ERROR_CODES = {
  EXPORT_CHATROOM_CHANGED: 'EXPORT_CHATROOM_CHANGED',
  EXPORT_FILE_EXISTS: 'EXPORT_FILE_EXISTS',
  EXPORT_PUBLISH_UNSUPPORTED: 'EXPORT_PUBLISH_UNSUPPORTED',
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
  EXPORT_PAGE_STALLED: 'EXPORT_PAGE_STALLED',
  EXPORT_DANGLING_REFERENCE: 'EXPORT_DANGLING_REFERENCE',
  EXPORT_TARGET_REQUIRED: 'EXPORT_TARGET_REQUIRED',
  EXPORT_TARGET_CONFLICT: 'EXPORT_TARGET_CONFLICT',
  EXPORT_NO_MACHINE_IDENTITY: 'EXPORT_NO_MACHINE_IDENTITY',
  EXPORT_MACHINE_TOO_LARGE: 'EXPORT_MACHINE_TOO_LARGE',
  EXPORT_ALL_INCOMPLETE: 'EXPORT_ALL_INCOMPLETE',
  IMPORT_NOT_AN_EXPORT: 'IMPORT_NOT_AN_EXPORT',
  IMPORT_UNSUPPORTED_VERSION: 'IMPORT_UNSUPPORTED_VERSION',
  IMPORT_CHECKSUM_MISMATCH: 'IMPORT_CHECKSUM_MISMATCH',
  IMPORT_FILE_UNREADABLE: 'IMPORT_FILE_UNREADABLE',
  IMPORT_FILE_TOO_LARGE: 'IMPORT_FILE_TOO_LARGE',
  IMPORT_UNKNOWN_TEAM_STRUCTURE: 'IMPORT_UNKNOWN_TEAM_STRUCTURE',
  IMPORT_DANGLING_REFERENCE: 'IMPORT_DANGLING_REFERENCE',
  IMPORT_INVALID_WORKING_DIR: 'IMPORT_INVALID_WORKING_DIR',
  IMPORT_MACHINE_NOT_FOUND: 'IMPORT_MACHINE_NOT_FOUND',
  IMPORT_MACHINE_NOT_OWNED: 'IMPORT_MACHINE_NOT_OWNED',
  IMPORT_NO_MACHINE_IDENTITY: 'IMPORT_NO_MACHINE_IDENTITY',
  IMPORT_CHUNK_FAILED: 'IMPORT_CHUNK_FAILED',
  IMPORT_ROLLED_BACK: 'IMPORT_ROLLED_BACK',
  IMPORT_ROLLBACK_FAILED: 'IMPORT_ROLLBACK_FAILED',
  IMPORT_TARGET_NOT_IMPORTING: 'IMPORT_TARGET_NOT_IMPORTING',
  // Client-side selection codes. These never cross the wire, so they are not
  // registered in services/backend/config/errorCodes.ts.
  IMPORT_SELECTION_REQUIRED: 'IMPORT_SELECTION_REQUIRED',
  IMPORT_SELECTION_INVALID: 'IMPORT_SELECTION_INVALID',
} as const;
export type TransferErrorCode = (typeof TRANSFER_ERROR_CODES)[keyof typeof TRANSFER_ERROR_CODES];

/**
 * A transfer failure raised outside a Convex function (the CLI, the export
 * build, the drivers). `code` is the machine-readable transfer code and
 * `details` carries one line per offending item (a dangling reference, for
 * example). The CLI renders it as `[CODE] message` followed by the details.
 *
 * Server-thrown failures use `ConvexError({ code, message })` instead, because
 * only Convex serialises that shape.
 */
export class ChatroomTransferError extends Error {
  readonly code: TransferErrorCode;
  readonly details: string[];

  constructor(code: TransferErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'ChatroomTransferError';
    this.code = code;
    this.details = details;
  }
}
