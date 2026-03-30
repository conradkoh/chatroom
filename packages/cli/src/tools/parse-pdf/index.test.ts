/**
 * Parse-PDF Tool — Unit Tests
 *
 * Tests the parse-pdf tool using injected dependencies (fake fs, mock parser,
 * mock HTTP client). No real file system, network, or PDF parsing.
 */

import { describe, expect, it } from 'vitest';

import type { ParsePdfDeps } from './deps.js';
import { parsePdf } from './index.js';

// ─── Fake Deps Factory ─────────────────────────────────────────────────────

function createFakeDeps(
  initialFiles: Record<string, string | Buffer> = {},
  overrides?: Partial<ParsePdfDeps>
): {
  store: Map<string, string | Buffer>;
  writtenFiles: Map<string, string>;
  deps: ParsePdfDeps;
} {
  const store = new Map<string, string | Buffer>(Object.entries(initialFiles));
  const writtenFiles = new Map<string, string>();

  const deps: ParsePdfDeps = {
    fs: {
      access: async (p: string) => {
        if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
      },
      readFile: async (p: string) => {
        const content = store.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return Buffer.isBuffer(content) ? content : Buffer.from(content);
      },
      writeFile: async (p: string, content: string, _encoding: BufferEncoding) => {
        store.set(p, content);
        writtenFiles.set(p, content);
      },
      mkdir: async (_p: string, _opts: { recursive: boolean }) => {
        // no-op: we don't actually create dirs in tests
      },
      readFileUtf8: async (p: string, _encoding: BufferEncoding) => {
        const content = store.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return typeof content === 'string' ? content : content.toString();
      },
      appendFile: async (p: string, content: string) => {
        const existing = store.get(p) ?? '';
        const value = typeof existing === 'string' ? existing + content : existing.toString() + content;
        store.set(p, value);
      },
    },
    parser: overrides?.parser ?? {
      parse: async (_input: string | Buffer) => {
        return { text: 'Extracted PDF text content here.' };
      },
    },
    http: overrides?.http ?? {
      download: async (_url: string) => {
        return Buffer.from('fake-pdf-bytes');
      },
    },
  };

  return { store, writtenFiles, deps };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('parsePdf', () => {
  describe('successful file parsing', () => {
    it('parses a local PDF file and writes output', async () => {
      const { writtenFiles, deps } = createFakeDeps({
        '/project/document.pdf': Buffer.from('fake-pdf-bytes'),
      });

      const result = await parsePdf('/project/document.pdf', '/project', deps);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();
      expect(result.outputPath).toContain('/project/.chatroom/parse-pdf-');
      expect(result.outputPath).toMatch(/\.txt$/);
      expect(result.message).toContain('PDF parsed successfully');
      expect(result.message).toContain(result.outputPath!);

      // Verify the output file was written with the parsed text
      expect(writtenFiles.size).toBe(1);
      const outputContent = writtenFiles.values().next().value;
      expect(outputContent).toBe('Extracted PDF text content here.');
    });

    it('includes the output file path in the result', async () => {
      const { deps } = createFakeDeps({
        '/project/report.pdf': Buffer.from('fake-pdf'),
      });

      const result = await parsePdf('/project/report.pdf', '/project', deps);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();
      expect(result.outputPath!.startsWith('/project/.chatroom/')).toBe(true);
    });
  });

  describe('file not found', () => {
    it('returns error when PDF file does not exist', async () => {
      const { deps } = createFakeDeps();

      const result = await parsePdf('/project/missing.pdf', '/project', deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain('PDF file not found');
      expect(result.message).toContain('missing.pdf');
      expect(result.outputPath).toBeUndefined();
    });
  });

  describe('URL input', () => {
    it('downloads and parses a PDF from a URL', async () => {
      const { writtenFiles, deps } = createFakeDeps();

      const result = await parsePdf('https://example.com/doc.pdf', '/project', deps);

      expect(result.success).toBe(true);
      expect(result.outputPath).toBeDefined();
      expect(result.outputPath).toContain('/project/.chatroom/parse-pdf-');
      expect(writtenFiles.size).toBe(1);
    });

    it('handles HTTP URL input', async () => {
      const { deps } = createFakeDeps();

      const result = await parsePdf('http://example.com/doc.pdf', '/project', deps);

      expect(result.success).toBe(true);
    });

    it('returns error when URL download fails', async () => {
      const { deps } = createFakeDeps({}, {
        http: {
          download: async () => {
            throw new Error('HTTP 404: Not Found');
          },
        },
      });

      const result = await parsePdf('https://example.com/missing.pdf', '/project', deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to download PDF');
      expect(result.message).toContain('HTTP 404');
    });
  });

  describe('parse error', () => {
    it('returns error when PDF parsing fails', async () => {
      const { deps } = createFakeDeps(
        { '/project/corrupt.pdf': Buffer.from('not-a-pdf') },
        {
          parser: {
            parse: async () => {
              throw new Error('Invalid PDF header');
            },
          },
        }
      );

      const result = await parsePdf('/project/corrupt.pdf', '/project', deps);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to parse PDF');
      expect(result.message).toContain('Invalid PDF header');
    });
  });

  describe('output path format', () => {
    it('generates output path with correct format', async () => {
      const { deps } = createFakeDeps({
        '/work/test.pdf': Buffer.from('pdf'),
      });

      const result = await parsePdf('/work/test.pdf', '/work', deps);

      expect(result.success).toBe(true);
      // Pattern: parse-pdf-YYYYMMDD-HHmmss-SSS.txt
      expect(result.outputPath).toMatch(/parse-pdf-\d{8}-\d{6}-\d{3}\.txt$/);
    });
  });
});
