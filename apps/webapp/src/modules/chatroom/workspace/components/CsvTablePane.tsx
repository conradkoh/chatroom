'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { memo, useEffect, useState } from 'react';
import { CsvTableRenderer } from '../file-renderers';
import { useFileContent } from '../hooks/useFileContent';

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

  // Reactively fetch cached content (with transparent decompression)
  const content = useFileContent({
    machineId,
    workingDir,
    filePath,
  });

  if (content === undefined || content === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Loading table…
      </div>
    );
  }

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
          <CsvTableRenderer content={content.content} />
        </div>
      </div>
    </div>
  );
});
