/**
 * Parse-PDF Tool — Extract text from a PDF file or URL.
 *
 * Uses @llamaindex/liteparse to convert PDF documents to plain text,
 * writing output to the `.chatroom/` temp directory.
 */

import { access, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ensureChatroomDir, ensureGitignore, generateOutputPath } from '../output.js';
import type { ToolResult } from '../types.js';
import type { ParsePdfDeps } from './deps.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Timeout for HTTP downloads in milliseconds (30 seconds). */
const FETCH_TIMEOUT_MS = 30_000;

/** Maximum download size in bytes (50 MB). */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check whether a string looks like a URL. */
function isUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://');
}

// ─── Default Deps ───────────────────────────────────────────────────────────

/** Create the default production dependencies. */
function createDefaultDeps(): ParsePdfDeps {
  return {
    fs: {
      // OutputFsOps methods
      access: (p) => access(p),
      mkdir: (p, opts) => mkdir(p, opts).then(() => {}),
      readFile: (p, enc) => readFile(p, { encoding: enc }).then((b) => b.toString()),
      appendFile: (p, content) => appendFile(p, content),
      // ParsePdfFsOps-specific methods
      readFileAsBuffer: (p) => readFile(p),
      writeFile: (p, content, enc) => writeFile(p, content, enc),
    },
    parser: {
      parse: async (input) => {
        // Lazy-import to avoid loading the heavy library until needed
        const { LiteParse } = await import('@llamaindex/liteparse');
        const parser = new LiteParse({ ocrEnabled: false, outputFormat: 'text' });
        const result = await parser.parse(input);
        return { text: result.text };
      },
    },
    http: {
      download: async (url) => {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Check Content-Length header for early rejection
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
          throw new Error('PDF exceeds maximum size of 50MB');
        }

        // Stream the response and enforce size limit
        if (!response.body) {
          throw new Error('Response body is empty');
        }

        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        const reader = response.body.getReader();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_DOWNLOAD_BYTES) {
            await reader.cancel();
            throw new Error('PDF exceeds maximum size of 50MB');
          }
          chunks.push(value);
        }

        return Buffer.concat(chunks);
      },
    },
  };
}

// ─── Tool Entry Point ───────────────────────────────────────────────────────

/**
 * Parse a PDF file or URL and write the extracted text to `.chatroom/`.
 *
 * @param input      - File path or URL to a PDF document
 * @param workingDir - Working directory for `.chatroom/` output
 * @param deps       - Optional dependencies for testing
 * @returns ToolResult with the output file path on success
 */
async function resolvePdfPath(
  input: string,
  workingDir: string,
  d: ParsePdfDeps
): Promise<{ pdfInput: string } | { error: string }> {
  const absolutePath = resolve(workingDir, input);
  try {
    await d.fs.access(absolutePath);
  } catch {
    return { error: `PDF file not found: ${absolutePath}` };
  }
  return { pdfInput: absolutePath };
}

function formatDownloadError(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return `Download timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function resolvePdfUrl(
  input: string,
  d: ParsePdfDeps
): Promise<{ pdfInput: Buffer } | { error: string }> {
  try {
    const pdfInput = await d.http.download(input);
    return { pdfInput };
  } catch (err) {
    return { error: `Failed to download PDF: ${formatDownloadError(err)}` };
  }
}

async function resolvePdfInput(
  input: string,
  workingDir: string,
  d: ParsePdfDeps
): Promise<{ pdfInput: string | Buffer } | { error: string }> {
  if (!isUrl(input)) {
    return resolvePdfPath(input, workingDir, d);
  }
  return resolvePdfUrl(input, d);
}

function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function parsePdf(
  input: string,
  workingDir: string,
  deps?: ParsePdfDeps
): Promise<ToolResult> {
  const d = deps ?? createDefaultDeps();

  try {
    await ensureChatroomDir({ fs: d.fs }, workingDir);
    await ensureGitignore({ fs: d.fs }, workingDir);
  } catch (err) {
    return {
      success: false,
      message: `Failed to prepare output directory: ${formatErrorMessage(err)}`,
    };
  }

  const resolved = await resolvePdfInput(input, workingDir, d);
  if ('error' in resolved) {
    return { success: false, message: resolved.error };
  }

  let text: string;
  try {
    const result = await d.parser.parse(resolved.pdfInput);
    text = result.text;
  } catch (err) {
    return { success: false, message: `Failed to parse PDF: ${formatErrorMessage(err)}` };
  }

  const outputPath = generateOutputPath(workingDir, 'parse-pdf', 'txt');

  try {
    await d.fs.writeFile(outputPath, text, 'utf8');
  } catch (err) {
    return { success: false, message: `Failed to write output file: ${formatErrorMessage(err)}` };
  }

  return {
    success: true,
    outputPath,
    message: `PDF parsed successfully. Output written to: ${outputPath}`,
  };
}
