'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { AlertTriangle, BookOpen, FileWarning, Table2 } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { isBinaryFile } from '../../components/FileSelector/binaryDetection';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileContentViewerProps {
  machineId: string;
  workingDir: string;
  filePath: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMarkdownFile(path: string): boolean {
  return /\.(md|mdx)$/i.test(path);
}

function isCsvFile(path: string): boolean {
  return /\.csv$/i.test(path);
}

/** Simple CSV parser — handles quoted fields with commas and newlines */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current);
        current = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(current);
        current = '';
        if (row.some((c) => c.length > 0)) rows.push(row);
        row = [];
        if (ch === '\r') i++;
      } else {
        current += ch;
      }
    }
  }
  // Last field
  row.push(current);
  if (row.some((c) => c.length > 0)) rows.push(row);

  return rows;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileContentViewer = memo(function FileContentViewer({
  machineId,
  workingDir,
  filePath,
}: FileContentViewerProps) {
  // Binary file guard
  if (isBinaryFile(filePath)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-chatroom-text-muted p-8">
        <FileWarning size={40} className="text-chatroom-text-muted/50" />
        <div className="text-sm">Binary file — cannot be displayed as text</div>
        <div className="text-xs text-chatroom-text-muted/70">{filePath}</div>
      </div>
    );
  }

  return (
    <FileContentInner
      machineId={machineId}
      workingDir={workingDir}
      filePath={filePath}
    />
  );
});

// ─── Inner Component (handles data fetching) ─────────────────────────────────

const FileContentInner = memo(function FileContentInner({
  machineId,
  workingDir,
  filePath,
}: FileContentViewerProps) {
  const [splitView, setSplitView] = useState(false);

  // Request file content from daemon
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    requestContent({ machineId, workingDir, filePath }).catch(() => {
      // Silently ignore — query will show loading or stale data
    });
  }, [machineId, workingDir, filePath, requestContent]);

  // Reactively fetch cached content
  const content = useSessionQuery(api.workspaceFiles.getFileContent, {
    machineId,
    workingDir,
    filePath,
  });

  const toggleSplitView = useCallback(() => {
    setSplitView((prev) => !prev);
  }, []);

  // Loading state
  if (content === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  // No content (daemon hasn't responded yet or file doesn't exist)
  if (content === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Waiting for file content…
      </div>
    );
  }

  const isMd = isMarkdownFile(filePath);
  const isCsv = isCsvFile(filePath);
  const showSplitToggle = isMd || isCsv;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Toolbar */}
      {(showSplitToggle || content.truncated) && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-chatroom-border shrink-0">
          {content.truncated && (
            <div className="flex items-center gap-1.5 text-chatroom-status-warning text-xs">
              <AlertTriangle size={14} />
              <span>Truncated</span>
            </div>
          )}
          <div className="flex-1" />
          {isMd && (
            <button
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors cursor-pointer',
                splitView
                  ? 'bg-chatroom-accent/15 text-chatroom-accent'
                  : 'text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
              )}
              onClick={toggleSplitView}
              title="Toggle markdown preview"
            >
              <BookOpen size={14} />
              Preview
            </button>
          )}
          {isCsv && (
            <button
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors cursor-pointer',
                splitView
                  ? 'bg-chatroom-accent/15 text-chatroom-accent'
                  : 'text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
              )}
              onClick={toggleSplitView}
              title="Toggle table view"
            >
              <Table2 size={14} />
              Edit
            </button>
          )}
        </div>
      )}

      {/* Content area — source only or split view */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Source panel */}
        <div className={cn('overflow-auto', splitView ? 'w-1/2 border-r border-chatroom-border' : 'flex-1')}>
          <pre className="p-4 text-[13px] leading-relaxed font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto">
            <code>{content.content}</code>
          </pre>
        </div>

        {/* Split panel — Markdown preview or CSV table */}
        {splitView && isMd && (
          <div className="w-1/2 overflow-auto p-4">
            <MarkdownPreview content={content.content} />
          </div>
        )}
        {splitView && isCsv && (
          <div className="w-1/2 overflow-auto p-4">
            <CsvTableView content={content.content} />
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Markdown Preview ─────────────────────────────────────────────────────────

const MarkdownPreview = memo(function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-chatroom-text-primary">
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</Markdown>
    </div>
  );
});

// ─── CSV Table View ───────────────────────────────────────────────────────────

const CsvTableView = memo(function CsvTableView({ content }: { content: string }) {
  const rows = useMemo(() => parseCsv(content), [content]);

  if (rows.length === 0) {
    return (
      <div className="text-chatroom-text-muted text-sm">No data found in CSV file.</div>
    );
  }

  const headerRow = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="overflow-auto">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr>
            {headerRow.map((cell, i) => (
              <th
                key={i}
                className="text-left px-3 py-1.5 font-semibold text-chatroom-text-primary bg-chatroom-bg-surface border border-chatroom-border whitespace-nowrap"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className="hover:bg-chatroom-bg-hover/50">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5 text-chatroom-text-secondary border border-chatroom-border whitespace-nowrap"
                >
                  {cell}
                </td>
              ))}
              {/* Pad short rows */}
              {row.length < headerRow.length &&
                Array.from({ length: headerRow.length - row.length }).map((_, pi) => (
                  <td key={`pad-${pi}`} className="px-3 py-1.5 border border-chatroom-border" />
                ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
