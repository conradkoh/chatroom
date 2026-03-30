/**
 * Parse-PDF Deps — dependency interfaces for the parse-pdf tool.
 *
 * Applies interface segregation so tests can mock I/O and parsing
 * without touching the real file system or @llamaindex/liteparse.
 */

// ─── File System Operations ─────────────────────────────────────────────────

/** File system operations needed by the parse-pdf tool. */
export interface ParsePdfFsOps {
  access: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<Buffer>;
  writeFile: (path: string, content: string, encoding: BufferEncoding) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  readFileUtf8: (path: string, encoding: BufferEncoding) => Promise<string>;
  appendFile: (path: string, content: string) => Promise<void>;
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
