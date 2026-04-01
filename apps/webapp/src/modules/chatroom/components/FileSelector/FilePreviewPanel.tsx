'use client';

import { Loader2 } from 'lucide-react';
import { memo } from 'react';

interface FilePreviewPanelProps {
  filePath: string | null;
  content: {
    content: string;
    encoding: string;
    truncated: boolean;
    fetchedAt: number;
  } | null;
  isLoading: boolean;
}

/** Known binary file extensions that should not be previewed. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.exe', '.dll', '.so', '.dylib',
  '.bin', '.dat', '.db', '.sqlite',
]);

function isBinaryFile(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

export const FilePreviewPanel = memo(function FilePreviewPanel({
  filePath,
  content,
  isLoading,
}: FilePreviewPanelProps) {
  if (!filePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          SELECT A FILE TO PREVIEW
        </span>
      </div>
    );
  }

  if (isBinaryFile(filePath)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted">
          BINARY FILE
        </span>
        <span className="text-[10px] font-mono text-chatroom-text-muted">{filePath}</span>
      </div>
    );
  }

  if (isLoading || !content) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-chatroom-text-muted" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex flex-col">
      {/* Preview header */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-chatroom-border bg-chatroom-bg-primary px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted font-mono truncate">
          {filePath}
        </span>
        {content.truncated && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 ml-2 shrink-0">
            TRUNCATED
          </span>
        )}
      </div>
      {/* Content */}
      <pre className="p-3 text-xs font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto leading-relaxed flex-1">
        {content.content}
      </pre>
    </div>
  );
});
