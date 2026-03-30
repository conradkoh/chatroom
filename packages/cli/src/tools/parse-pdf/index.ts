/**
 * Parse-PDF Tool — Extract text from a PDF file or URL.
 *
 * Uses @llamaindex/liteparse to convert PDF documents to plain text,
 * writing output to the `.chatroom/` temp directory.
 */

import { access, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { ToolResult } from '../types.js';
import { ensureChatroomDir, ensureGitignore, generateOutputPath } from '../output.js';
import type { ParsePdfDeps } from './deps.js';

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
      access: (p) => access(p),
      readFile: (p) => readFile(p),
      writeFile: (p, content, enc) => writeFile(p, content, enc),
      mkdir: (p, opts) => mkdir(p, opts).then(() => {}),
      readFileUtf8: (p, enc) => readFile(p, { encoding: enc }).then((b) => b.toString()),
      appendFile: (p, content) => appendFile(p, content),
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
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
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
export async function parsePdf(
  input: string,
  workingDir: string,
  deps?: ParsePdfDeps
): Promise<ToolResult> {
  const d = deps ?? createDefaultDeps();

  // ── Prepare output directory ──────────────────────────────────────────
  const outputDeps = {
    fs: {
      mkdir: d.fs.mkdir,
      readFile: d.fs.readFileUtf8,
      appendFile: d.fs.appendFile,
      access: d.fs.access,
    },
  };

  try {
    await ensureChatroomDir(outputDeps, workingDir);
    await ensureGitignore(outputDeps, workingDir);
  } catch (err) {
    return {
      success: false,
      message: `Failed to prepare output directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── Resolve input ─────────────────────────────────────────────────────
  let pdfInput: string | Buffer;

  if (isUrl(input)) {
    // Download from URL
    try {
      pdfInput = await d.http.download(input);
    } catch (err) {
      return {
        success: false,
        message: `Failed to download PDF: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    // Local file path
    const absolutePath = resolve(workingDir, input);
    try {
      await d.fs.access(absolutePath);
    } catch {
      return {
        success: false,
        message: `PDF file not found: ${absolutePath}`,
      };
    }
    pdfInput = absolutePath;
  }

  // ── Parse PDF ─────────────────────────────────────────────────────────
  let text: string;
  try {
    const result = await d.parser.parse(pdfInput);
    text = result.text;
  } catch (err) {
    return {
      success: false,
      message: `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // ── Write output ──────────────────────────────────────────────────────
  const outputPath = generateOutputPath(workingDir, 'parse-pdf', 'txt');

  try {
    await d.fs.writeFile(outputPath, text, 'utf8');
  } catch (err) {
    return {
      success: false,
      message: `Failed to write output file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return {
    success: true,
    outputPath,
    message: `PDF parsed successfully. Output written to: ${outputPath}`,
  };
}
