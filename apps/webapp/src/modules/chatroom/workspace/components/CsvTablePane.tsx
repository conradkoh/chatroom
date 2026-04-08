'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { memo, useEffect, useMemo, useState } from 'react';

// ─── CSV Parser ───────────────────────────────────────────────────────────────

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
      } else if (ch === '\n' || ch === '\r') {
        row.push(current);
        current = '';
        if (row.some((c) => c.length > 0)) rows.push(row);
        row = [];
        // Handle \r\n as single newline
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else {
        current += ch;
      }
    }
  }
  row.push(current);
  if (row.some((c) => c.length > 0)) rows.push(row);

  return rows;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CsvTablePaneProps {
  machineId: string;
  workingDir: string;
  filePath: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CsvTablePane = memo(function CsvTablePane({
  machineId,
  workingDir,
  filePath,
}: CsvTablePaneProps) {
  const [zoom, setZoom] = useState(100);

  // Request file content from daemon
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    requestContent({ machineId, workingDir, filePath }).catch(() => {});
  }, [machineId, workingDir, filePath, requestContent]);

  // Reactively fetch cached content
  const content = useSessionQuery(api.workspaceFiles.getFileContent, {
    machineId,
    workingDir,
    filePath,
  });

  const rows = useMemo(() => {
    if (!content?.content) return [];
    return parseCsv(content.content);
  }, [content?.content]);

  if (content === undefined || content === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Loading table…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        No data found in CSV file.
      </div>
    );
  }

  const headerRow = rows[0];
  const dataRows = rows.slice(1);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Zoom control */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-chatroom-border shrink-0">
        <span className="text-[11px] text-chatroom-text-muted">Zoom</span>
        <input
          type="range"
          min={50}
          max={200}
          step={10}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-24 h-1 accent-chatroom-accent"
        />
        <span className="text-[11px] text-chatroom-text-muted w-8">{zoom}%</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        <div style={{ fontSize: `${zoom}%` }}>
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
                  {row.length < headerRow.length &&
                    Array.from({ length: headerRow.length - row.length }).map((_, pi) => (
                      <td key={`pad-${pi}`} className="px-3 py-1.5 border border-chatroom-border" />
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
