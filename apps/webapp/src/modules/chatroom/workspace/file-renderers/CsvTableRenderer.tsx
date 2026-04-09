'use client';

import { memo, useMemo } from 'react';
import { parseCsv } from './csvParser';

interface CsvTableRendererProps {
  content: string;
  className?: string;
}

export const CsvTableRenderer = memo(function CsvTableRenderer({ content, className }: CsvTableRendererProps) {
  const rows = useMemo(() => parseCsv(content), [content]);

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
    <div className={className}>
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
  );
});
