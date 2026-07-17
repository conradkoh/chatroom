'use client';

import { Download } from 'lucide-react';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { ResponsivePickerShell, PickerScrollBody, PickerOptionRow } from '../../components/picker';
import {
  downloadTextFile,
  messageExportFilename,
  buildMessageMarkdownDownload,
  printMessageAsPdf,
} from '../../lib/messageExport';
import type { Message } from '../../types/message';

interface MessageDownloadMenuProps {
  message: Message;
}

export function MessageDownloadMenu({ message }: MessageDownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleMarkdown = useCallback(() => {
    downloadTextFile(
      messageExportFilename(message, 'md'),
      buildMessageMarkdownDownload(message),
      'text/markdown'
    );
    toast.success('Downloaded markdown');
    setOpen(false);
  }, [message]);

  const handlePdf = useCallback(async () => {
    setBusy(true);
    try {
      await printMessageAsPdf(message);
      toast.success('Opened print dialog — save as PDF');
    } catch {
      toast.error('Failed to prepare PDF');
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
        <PickerOptionRow selected={false} onSelect={handlePdf} disabled={busy}>
          <span>{busy ? 'Preparing PDF...' : 'Download as PDF'}</span>
        </PickerOptionRow>
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
