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
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Select a file to preview
      </div>
    );
  }

  if (isBinaryFile(filePath)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <span className="text-sm font-medium">Binary file</span>
        <span className="text-xs">{filePath}</span>
      </div>
    );
  }

  if (isLoading || !content) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-1.5">
        <span className="text-xs text-muted-foreground font-mono truncate">{filePath}</span>
        {content.truncated && (
          <span className="text-xs text-yellow-600 dark:text-yellow-400 ml-2 shrink-0">
            Truncated
          </span>
        )}
      </div>
      <pre className="p-3 text-xs font-mono text-foreground whitespace-pre overflow-x-auto leading-relaxed">
        {content.content}
      </pre>
    </div>
  );
});
