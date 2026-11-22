'use client';

import { Download } from 'lucide-react';
import { useState, useCallback } from 'react';

import { ResponsivePickerShell, PickerScrollBody, PickerOptionRow } from '../../components/picker';
import {
  saveTextFile,
  messageExportFilename,
  buildMessageMarkdownDownload,
  exportMessageAsDocx,
  exportMessageAsPdf,
} from '../../lib/messageExport';
import type { Message } from '../../types/message';

import { InlineFeedback } from '@/components/inline-feedback';
import { useFeedback } from '@/hooks/useFeedback';

interface MessageDownloadMenuProps {
  message: Message;
  /** When set, export uses this content instead of message.content. */
  contentOverride?: string;
}

/** The export row currently running. `null` when idle. */
type BusyAction = 'docx' | 'pdf';

export function MessageDownloadMenu({ message, contentOverride }: MessageDownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const { feedback, error: showError, clear: clearFeedback } = useFeedback();
  // Any running export disables every row; only `busyAction` decides which row shows progress.
  const busy = busyAction !== null;

  const exportMessage =
    contentOverride != null ? { ...message, content: contentOverride } : message;

  const handleMarkdown = useCallback(async () => {
    clearFeedback();
    await saveTextFile(
      messageExportFilename(exportMessage, 'md'),
      buildMessageMarkdownDownload(exportMessage),
      'text/markdown',
      ['.md']
    );
    setOpen(false);
  }, [exportMessage, clearFeedback]);

  const handleDocx = useCallback(async () => {
    clearFeedback();
    setBusyAction('docx');
    try {
      await exportMessageAsDocx(exportMessage);
    } catch (error) {
      console.error('[MessageDownloadMenu] DOCX export failed', error);
      showError('Failed to prepare DOCX');
    } finally {
      setBusyAction(null);
      setOpen(false);
    }
  }, [exportMessage, clearFeedback, showError]);

  const handlePdf = useCallback(async () => {
    clearFeedback();
    setBusyAction('pdf');
    try {
      await exportMessageAsPdf(exportMessage);
    } catch (error) {
      console.error('[MessageDownloadMenu] PDF export failed', error);
      showError('Failed to prepare PDF');
    } finally {
      setBusyAction(null);
      setOpen(false);
    }
  }, [exportMessage, clearFeedback, showError]);

  return (
    <>
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
            <span>{busyAction === 'docx' ? 'Preparing DOCX...' : 'Download as DOCX'}</span>
          </PickerOptionRow>
          <PickerOptionRow selected={false} onSelect={handlePdf} disabled={busy}>
            <span>{busyAction === 'pdf' ? 'Preparing PDF...' : 'Download as PDF'}</span>
          </PickerOptionRow>
        </PickerScrollBody>
      </ResponsivePickerShell>
      {/* Outside the picker on purpose: the menu closes after every action, including a failed one,
          and the failure must stay visible next to the trigger until the next action clears it. */}
      <InlineFeedback feedback={feedback} variant="text" data-testid="message-download-feedback" />
    </>
  );
}
