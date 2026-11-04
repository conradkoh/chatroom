---
type: decision-log
title: Handoff file attachments
description: User-addressed handoff files stored in Convex, gated to handoffs to user, with per-user and per-chatroom storage accounting.
tags: [attachments, handoff, convex, storage, quota, cli]
status: active
---

# Handoff file attachments

## Context

Agents need to hand files to the user (`--next-role=user`) without sending bytes
through the daemon or exposing storage URLs to the CLI. These are the decisions
that shape the feature; the implementation lives in the S1–S8 slices.

## Decisions

1. **Storage.** Blobs live in Convex `_storage`; metadata lives in
   `chatroom_fileAttachments`. Bytes arrive through a Convex HTTP action that
   checks the session, calls `ctx.storage.store()`, then binds the blob in an
   internal mutation and deletes the blob if binding fails. Clients never supply
   a `storageId`.
2. **Message field.** A handoff message carries `attachedFileIds`, mirroring
   `attachedArtifactIds`. Artifact behaviour is unchanged.
3. **Enforcement.** `FILE_ATTACHMENTS_REQUIRE_USER_TARGET` is checked in
   `runHandoffHandler` before any write. The CLI rejects `--attach-file` with a
   non-user `--next-role` before reading or uploading anything.
4. **Upload flow.** The CLI runs `beginUpload`, POSTs the bytes, then `handoff`
   with `attachedFileIds`; a failed handoff calls `discardUploads`. The replay
   path deletes unbound uploads in the same transaction, and the expiry cron is
   the backstop.
5. **Limits.** 10 MiB per file, 10 files per handoff, 255-character filenames.
   The MIME allowlist is resolved from the extension on the server: png,
   jpg/jpeg, gif, webp, svg, pdf, txt, log, md, csv, json, html/htm, zip.
   One owner may hold at most 20 live unbound rows in total across
   `pending_upload` and `uploaded` (`FILE_ATTACHMENT_MAX_PENDING_PER_USER`);
   expired rows are not counted. A new reservation is rejected at that cap.
6. **Access.** Upload and attach accept any chatroom-access session.
   `beginUpload` creates rows whose `ownerUserId` is the chatroom owner (its row
   insert lives in
   `services/backend/src/domain/usecase/file-attachment/lifecycle.ts`). Only
   `runHandoffHandler` binds rows. It checks that each row's `ownerUserId`
   equals the chatroom owner (`checkAttachmentBinding`), and it checks chatroom,
   owner, role, status and expiry in that order. Reads
   (`getFileUrls`), listing, delete, purge, and settings require a `web` session
   (`WEB_SESSION_REQUIRED` for CLI, `ACCESS_DENIED` for non-owners). URLs are
   never persisted or returned to the CLI. HTML and SVG are stored as
   `application/octet-stream`; HTML previews as escaped source; SVG renders only
   inside `<img>`; downloads use an `application/octet-stream` blob; no
   `window.open` on `blob:` URLs.
7. **Quotas and purge.** Defaults are 1 GiB per user and 256 MiB per chatroom;
   effective chatroom quota is min(chatroom, user), with a 5 GiB platform ceiling
   per level as a code constant. Usage is a stored counter
   (`chatroom_fileStorageUsage`) updated in the same transaction as each change.
   Over-quota converges by oldest-first eviction of `attached` rows only,
   chatroom scope first then user, in batches of 50. `purgeFiles` runs in batches
   of 100.
8. **Tests.** Backend specs use `convex-test` with the real schema; CLI tests
   substitute only the existing gateway port and the attachment-uploader port.
9. **Storage URL capability (accepted risk).** `getFileUrls` authorizes the
   caller and then mints a `ctx.storage.getUrl` URL. That URL is a bearer
   capability: it works without a session until the blob is deleted. URLs are
   minted per read and never persisted or returned to the CLI. Accepted because
   the URL is unguessable and is shown only to the owner's web session. Open
   verification items: Convex URL lifetime semantics, whether storage sets
   `X-Content-Type-Options: nosniff`, and whether the gateway passes
   `Content-Length` through unchanged. Revisit if any is unacceptable.
10. **Upload request framing.** The upload POST must declare `Content-Length`.
    Missing, non-finite, or negative values are rejected with 411; a value above
    the 10 MiB maximum is rejected with 413. Both checks run in preflight,
    before the ticket is authorized and before the body is read. After
    authorization, a declared length different from the reserved size is
    rejected with 400 before the body read; `readUploadBody` then requires the
    bytes actually read to equal the reserved size. Convex gateway pass-through
    of `Content-Length` is covered only by `convex-test`; verify once against a
    real deployment.
11. **CLI upload origin.** The CLI attaches the session bearer only to: the
    configured backend origin; a loopback upload host on the Convex local site
    port (backend port + 1), where any two loopback hosts pair (`localhost`,
    `127.0.0.1`, `[::1]`); or `https://<name>.convex.site` when the backend is
    `https://<name>.convex.cloud` with no port. HTTPS is required except for
    loopback. Any other origin is refused before a request is sent. Known
    limitation: there is no environment-variable override or configurable
    origin list, so self-hosted or custom-domain Convex deployments cannot
    upload until a decision adds one.
12. **Web-session helpers.** The file and storage-settings guards live in
    `convex/auth/webSession.ts` (`requireWebSession`, `requireWebCaller`), not
    inline in each endpoint. `discardUploads` accepts any session type because
    it skips `attached` rows and only deletes the caller's own rows.

## Known gaps

- **SVG previews.** The backend stores SVG as `application/octet-stream`, and
  `<img>` will not render that, so SVG thumbnails and previews show the
  "Preview unavailable" / "Couldn't load this image" state. A fix needs a
  backend retrieval change and is pending a user decision.
- **Unnamed chatrooms.** The file list used to read "Deleted chatroom" for a live
  chatroom whose optional name is unset. `listFiles` now returns
  `chatroomDeleted` alongside the optional `chatroomName`, and the list labels
  live unnamed rooms "Untitled chatroom".
- **Symlinked attachments.** The CLI `stat`s each path, which follows symlinks,
  so a symlink named `x.txt` uploads its target's bytes under an allow-listed
  extension. Accepted: the destination is the user's own chatroom, the agent
  could already read the target, and served content never executes on the app
  origin. A `lstat` plus `realpath` allow-list is the stricter option.
- **Missing vs. forbidden ids.** `getFileUrls` and `deleteFile` return `null` /
  `deleted: false` for a missing row and throw `ACCESS_DENIED` for a foreign
  row. Accepted: ids are unguessable and existence is revealed only to an
  authenticated caller.
- **Self-hosted upload origins.** See decision 11; self-hosted or custom-domain
  Convex deployments have no allowed upload origin.
