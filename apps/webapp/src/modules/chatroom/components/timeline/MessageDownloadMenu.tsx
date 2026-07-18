'use client';

import { Download } from 'lucide-react';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { ResponsivePickerShell, PickerScrollBody, PickerOptionRow } from '../../components/picker';
import {
  saveTextFile,
  messageExportFilename,
  buildMessageMarkdownDownload,
  exportMessageAsDocx,
} from '../../lib/messageExport';
import type { Message } from '../../types/message';

interface MessageDownloadMenuProps {
  message: Message;
}

export function MessageDownloadMenu({ message }: MessageDownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleMarkdown = useCallback(async () => {
    const result = await saveTextFile(
      messageExportFilename(message, 'md'),
      buildMessageMarkdownDownload(message),
      'text/markdown',
      ['.md']
    );
    if (result !== 'cancelled') {
      toast.success(result === 'saved' ? 'Saved markdown' : 'Downloaded markdown');
    }
    setOpen(false);
  }, [message]);

  const handleDocx = useCallback(async () => {
    setBusy(true);
    try {
      const result = await exportMessageAsDocx(message);
      if (result === 'cancelled') return;
      toast.success(result === 'saved' ? 'Saved DOCX' : 'Downloaded DOCX');
    } catch {
      toast.error('Failed to prepare DOCX');
    } finally {
      setBusy(false);
      setOpen(false);
    }
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
        <PickerOptionRow selected={false} onSelect={handleMarkdown} disabled={busy}>
          <span>Download as Markdown</span>
        </PickerOptionRow>
        <PickerOptionRow selected={false} onSelect={handleDocx} disabled={busy}>
          <span>{busy ? 'Preparing DOCX...' : 'Download as DOCX'}</span>
        </PickerOptionRow>
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
