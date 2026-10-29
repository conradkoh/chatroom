/**
 * Shared fal client — the one fal adapter every command uses.
 *
 * `generate-image`, `generate-3d`, and `remove-image-background-fal` all queue
 * the same submit/poll call and upload inputs through the same storage API, so
 * that wiring lives here instead of inside one command that the others import.
 *
 * This module deliberately knows nothing about any command's error class. It
 * throws `FalClientError`, and each command translates that into its own class
 * (for example `GenerateImageError`) with the same message, so the words a user
 * sees do not change when the wiring moves.
 *
 * It imports nothing from a command folder: only `@fal-ai/client` and
 * `node:fs/promises`.
 *
 * Pure modules must not import this file; import shared constants from
 * `fal-messages.ts` so the SDK stays lazy-loaded.
 */

import { readFile } from 'node:fs/promises';

import { ApiError, ValidationError, fal } from '@fal-ai/client';

import { FAL_API_KEY_MISSING_MESSAGE } from './fal-messages.js';

/**
 * Failure raised by this adapter. Callers re-throw their own error class with
 * the same message, so this name is internal and never printed.
 */
export class FalClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FalClientError';
  }
}

/** Server-side timeout for the queued generation (the SDK takes seconds). */
const SUBSCRIBE_TIMEOUT_SECONDS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ─── fal error mapping ─────────────────────────────────────────────────────

function requestSuffix(requestId: string | undefined): string {
  return requestId ? ` [requestId: ${requestId}]` : '';
}

/** Render one `{ loc, msg }` pair, omitting whichever part is absent. */
function formatDetailParts(loc: unknown, msg: unknown): string {
  const location = Array.isArray(loc) ? loc.join('.') : '';
  const message = typeof msg === 'string' ? msg : '';
  return [location, message].filter((part) => part.length > 0).join(': ');
}

function formatDetailList(detail: unknown[]): string | undefined {
  const parts = detail
    .filter(isRecord)
    .map((item) => formatDetailParts(item.loc, item.msg))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function formatBodyMessage(message: unknown): string | undefined {
  if (typeof message !== 'string' || message.length === 0) return undefined;
  return message;
}

function formatBodyDetail(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (Array.isArray(body.detail)) return formatDetailList(body.detail);
  return formatBodyMessage(body.message);
}

function formatValidationError(err: ValidationError): string {
  const detail = formatDetailList(Array.isArray(err.fieldErrors) ? err.fieldErrors : []);
  return `fal rejected the request (HTTP ${err.status})${detail ? `: ${detail}` : ''}${requestSuffix(err.requestId)}`;
}

function formatApiError(err: ApiError<unknown>): string {
  const detail = formatBodyDetail(err.body);
  return `fal request failed (HTTP ${err.status})${detail ? `: ${detail}` : ''}${requestSuffix(err.requestId)}`;
}

/**
 * fal's 422 bodies carry a `detail[]` list, but `ApiError.message` only holds
 * the status text ("Unprocessable Entity"). Surface the field errors and the
 * request id instead. Headers, and therefore the API key, are never included.
 */
function describeFalError(err: unknown): string {
  if (err instanceof ValidationError) return formatValidationError(err);
  if (err instanceof ApiError) return formatApiError(err);
  return err instanceof Error ? err.message : String(err);
}

/**
 * Point the SDK at the caller's API key. The SDK's built-in credential
 * resolver does not read `FAL_API_KEY`, so it is passed explicitly; the key is
 * never logged or included in an error message.
 */
function configureFal(env: Record<string, string | undefined>): void {
  const credentials = env.FAL_API_KEY;
  if (!credentials) {
    // Defense in depth: commands guard first, and this keeps a direct adapter
    // call from silently falling back to the SDK's environment lookup.
    throw new FalClientError(FAL_API_KEY_MISSING_MESSAGE);
  }
  fal.config({ credentials });
}

/**
 * Adapter around the official fal SDK. `fal.subscribe` performs queue submit +
 * poll.
 *
 * The result is returned unvalidated: command-specific validators differ by
 * model shape (`images[]` for text-to-image, `image` for BiRefNet), so each
 * caller narrows the raw result itself.
 */
export function createFalRawSubscribe(
  env: Record<string, string | undefined>
): (model: string, input: Record<string, unknown>) => Promise<unknown> {
  return async (model, input) => {
    configureFal(env);

    try {
      return await fal.subscribe(model, {
        input,
        logs: false,
        startTimeout: SUBSCRIBE_TIMEOUT_SECONDS,
      });
    } catch (err) {
      throw new FalClientError(describeFalError(err));
    }
  };
}

/**
 * Uploads an input file so a model can fetch it by URL. A one-day lifetime
 * keeps the temporary object from accumulating.
 */
export function createFalUploadFile(
  env: Record<string, string | undefined>
): (path: string, contentType: string) => Promise<string> {
  return async (path, contentType) => {
    configureFal(env);
    try {
      const bytes = await readFile(path);
      const blob = new Blob([new Uint8Array(bytes)], { type: contentType });
      return await fal.storage.upload(blob, { lifecycle: { expiresIn: '1d' } });
    } catch (err) {
      throw new FalClientError(`Failed to upload input image ${path}: ${describeFalError(err)}`);
    }
  };
}
