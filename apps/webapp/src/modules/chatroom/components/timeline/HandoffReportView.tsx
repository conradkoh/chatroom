'use client';

import { memo, useMemo, useState } from 'react';

import { HandoffCollapsibleSection } from './HandoffCollapsibleSection';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { parseHandoffReport } from '../../utils/parseHandoffReport';
import type { HandoffReportParseResult } from '../../utils/parseHandoffReport';

export type HandoffReportViewVariant = 'timeline' | 'detail';

export interface HandoffReportViewProps {
  content: string;
  variant?: HandoffReportViewVariant;
}

const STRUCTURED_SECTIONS = [
  { id: 'overview', label: 'Overview', key: 'overview' as const, defaultOpen: true },
  { id: 'proofs', label: 'Proofs', key: 'proofs' as const, defaultOpen: false },
  { id: 'direction', label: 'Direction', key: 'direction' as const, defaultOpen: false },
  { id: 'notes', label: 'Notes', key: 'notes' as const, defaultOpen: false },
  { id: 'action', label: 'Action required', key: 'action' as const, defaultOpen: true },
] as const;

function StructuredView({ parsed }: { parsed: HandoffReportParseResult }) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(STRUCTURED_SECTIONS.map((s) => [s.id, s.defaultOpen]))
  );

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-2">
      {STRUCTURED_SECTIONS.map((section) => {
        const body = parsed[section.key];
        if (!body) return null;
        const isOpen = openSections[section.id] ?? section.defaultOpen;
        return (
          <HandoffCollapsibleSection
            key={section.id}
            id={section.id}
            label={section.label}
            body={body}
            isOpen={isOpen}
            onToggle={() => toggleSection(section.id)}
            useActionMarkdown={section.key === 'action'}
          />
        );
      })}
    </div>
  );
}

function LegacyView({
  parsed,
  variant,
}: {
  parsed: HandoffReportParseResult;
  variant: HandoffReportViewVariant;
}) {
  const [proofsOpen, setProofsOpen] = useState(variant === 'detail');
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="space-y-2">
      {parsed.summary && <TimelineMarkdownBody content={parsed.summary} />}

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
  );
}

export const HandoffReportView = memo(function HandoffReportView({
  content,
  variant = 'timeline',
}: HandoffReportViewProps) {
  const parsed = useMemo(() => parseHandoffReport(content), [content]);
  const [showRaw, setShowRaw] = useState(false);

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

      {parsed.format === 'structured' ? (
        <StructuredView parsed={parsed} />
      ) : (
        <LegacyView parsed={parsed} variant={variant} />
      )}
    </div>
  );
});
