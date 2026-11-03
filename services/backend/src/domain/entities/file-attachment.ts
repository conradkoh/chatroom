/**
 * File Attachment entity — lifecycle status domain, TTLs, and quota defaults.
 *
 * The status set is backend-owned, so the Zod enum is the single source of
 * truth; the Convex validator is derived from its options and a sync test
 * guards against drift.
 *
 * @see docs/conventions/domain-models.md
 */

// The status enum is the single source of truth for the validator below, and
// its co-located drift test imports the schema. The dead-code scan does not
// count that test as a consumer, so suppress the two false positives.
// fallow-ignore-file unused-export unused-type

import { v } from 'convex/values';
import { z } from 'zod';

import { toLiteralValidators } from './_shared/v-literals-of';
import type { Id } from '../../../convex/_generated/dataModel';

// ─── Status domain ──────────────────────────────────────────────────────────

/**
 * - `pending_upload`: row created, blob not yet stored.
 * - `uploaded`: blob stored but not yet bound to a delivered handoff.
 * - `attached`: bound to a handoff message and visible in the timeline.
 */
export const fileAttachmentStatusSchema = z.enum(['pending_upload', 'uploaded', 'attached']);

/** TS type of a file attachment lifecycle status. */
export type FileAttachmentStatus = z.infer<typeof fileAttachmentStatusSchema>;

/** Convex validator derived from the status enum options. */
export const fileAttachmentStatusValidator = v.union(
  ...toLiteralValidators(fileAttachmentStatusSchema.options)
);

// ─── Lifecycle windows ──────────────────────────────────────────────────────

/** How long a `pending_upload` row may live before it is purged (15 min). */
export const PENDING_UPLOAD_TTL_MS = 15 * 60 * 1000;

/** How long an `uploaded` but unbound row may live before eviction (60 min). */
export const UPLOADED_UNATTACHED_TTL_MS = 60 * 60 * 1000;

// ─── Quota defaults ─────────────────────────────────────────────────────────

/** Default storage quota per user (1 GiB). */
export const DEFAULT_USER_FILE_QUOTA_BYTES = 1024 ** 3;

/** Default storage quota per chatroom (256 MiB). */
export const DEFAULT_CHATROOM_FILE_QUOTA_BYTES = 256 * 1024 ** 2;

/** Hard ceiling for any per-user or per-chatroom quota (5 GiB). */
export const PLATFORM_MAX_FILE_QUOTA_BYTES = 5 * 1024 ** 3;

// ─── Maintenance batch sizes ────────────────────────────────────────────────

/** Rows removed per purge batch. */
export const FILE_PURGE_BATCH_SIZE = 100;

/** Rows evicted per quota-eviction batch. */
export const FILE_EVICTION_BATCH_SIZE = 50;

/** Rows expired per expiry batch. */
export const FILE_EXPIRY_BATCH_SIZE = 100;

/** Maximum page size for attachment listings. */
export const FILE_LIST_PAGE_MAX = 25;

// ─── Read model ─────────────────────────────────────────────────────────────

/** View shape returned by enrichMessages for an attached file. */
export type AttachedFileView =
  | {
      _id: Id<'chatroom_fileAttachments'>;
      status: 'available';
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }
  | { _id: Id<'chatroom_fileAttachments'>; status: 'removed' };
