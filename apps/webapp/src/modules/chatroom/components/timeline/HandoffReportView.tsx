'use client';

import { memo, useMemo, useState } from 'react';

import { HandoffCollapsibleSection } from './HandoffCollapsibleSection';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { parseHandoffReport } from '../../utils/parseHandoffReport';

export type HandoffReportViewVariant = 'timeline' | 'detail';

export interface HandoffReportViewProps {
  content: string;
  variant?: HandoffReportViewVariant;
}

export const HandoffReportView = memo(function HandoffReportView({
  content,
  variant = 'timeline',
}: HandoffReportViewProps) {
  const parsed = useMemo(() => parseHandoffReport(content), [content]);
  const [showRaw, setShowRaw] = useState(false);
  const [proofsOpen, setProofsOpen] = useState(variant === 'detail');
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (showRaw) {
    return (
      <div data-testid="handoff-report-view" className="space-y-2">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowRaw(false)}
            className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info hover:underline"
            data-testid="handoff-report-raw-toggle"
          >
            Structured
          </button>
        </div>
        <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-chatroom-bg-tertiary border border-chatroom-border p-3 max-h-96 overflow-y-auto">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div data-testid="handoff-report-view" className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowRaw(true)}
          className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info hover:underline"
          data-testid="handoff-report-raw-toggle"
        >
          Raw
        </button>
      </div>

      {/* Summary — always visible */}
      <TimelineMarkdownBody content={parsed.summary} />

      {/* Collapsible sections */}
      <div className="space-y-2">
        {parsed.proofs && (
          <HandoffCollapsibleSection
            id="handoff-proofs"
            label="Proofs"
            body={parsed.proofs}
            isOpen={proofsOpen}
            onToggle={() => setProofsOpen((v) => !v)}
          />
        )}
        {parsed.details && (
          <HandoffCollapsibleSection
            id="handoff-details"
            label="Details"
            body={parsed.details}
            isOpen={detailsOpen}
            onToggle={() => setDetailsOpen((v) => !v)}
          />
        )}
      </div>
    </div>
  );
});
