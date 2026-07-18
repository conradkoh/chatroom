'use client';

import { Download } from 'lucide-react';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { ResponsivePickerShell, PickerScrollBody, PickerOptionRow } from '../../components/picker';
import {
  downloadTextFile,
  messageExportFilename,
  buildMessageMarkdownDownload,
} from '../../lib/messageExport';
import type { Message } from '../../types/message';

interface MessageDownloadMenuProps {
  message: Message;
}

export function MessageDownloadMenu({ message }: MessageDownloadMenuProps) {
  const [open, setOpen] = useState(false);

  const handleMarkdown = useCallback(() => {
    downloadTextFile(
      messageExportFilename(message, 'md'),
      buildMessageMarkdownDownload(message),
      'text/markdown'
    );
    toast.success('Downloaded markdown');
    setOpen(false);
  }, [message]);

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={setOpen}
      title="Download message"
      align="end"
      trigger={
        <button
          type="button"
          className="flex items-center justify-center w-6 h-6 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors"
          title="Download message"
          aria-label="Download message"
        >
          <Download size={12} />
        </button>
      }
    >
      <PickerScrollBody>
        <PickerOptionRow selected={false} onSelect={handleMarkdown}>
          <span>Download as Markdown</span>
        </PickerOptionRow>
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
