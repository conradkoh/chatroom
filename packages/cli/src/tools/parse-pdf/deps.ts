/**
 * Parse-PDF Deps — dependency interfaces for the parse-pdf tool.
 *
 * Applies interface segregation so tests can mock I/O and parsing
 * without touching the real file system or @llamaindex/liteparse.
 */

import type { OutputFsOps } from '../output.js';

// ─── File System Operations ─────────────────────────────────────────────────

/**
 * File system operations needed by the parse-pdf tool.
 * Extends OutputFsOps (mkdir, readFile, appendFile, access) and adds
 * PDF-specific operations for binary reads and file writes.
 */
export interface ParsePdfFsOps extends OutputFsOps {
  /** Read a file as a raw Buffer (for binary PDF data). */
  readFileAsBuffer: (path: string) => Promise<Buffer>;
  /** Write string content to a file. */
  writeFile: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
}

// ─── PDF Parser ─────────────────────────────────────────────────────────────

/** Result of parsing a PDF document. */
export interface PdfParseResult {
  /** Full document text, concatenated from all pages. */
  text: string;
}

/** PDF parser abstraction for dependency injection. */
export interface PdfParser {
  /** Parse a PDF from a file path or buffer and return the extracted text. */
  parse: (input: string | Buffer) => Promise<PdfParseResult>;
}

// ─── Network ────────────────────────────────────────────────────────────────

/** HTTP fetch abstraction for downloading PDFs from URLs. */
export interface HttpClient {
  /** Download a URL and return the response body as a Buffer. */
  download: (url: string) => Promise<Buffer>;
}

// ─── Combined Deps ──────────────────────────────────────────────────────────

/**
 * All external dependencies for the parse-pdf tool.
 */
export interface ParsePdfDeps {
  fs: ParsePdfFsOps;
  parser: PdfParser;
  http: HttpClient;
}
