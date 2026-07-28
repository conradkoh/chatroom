'use client';

import { memo, useMemo, useState } from 'react';

import { HandoffCollapsibleSection } from './HandoffCollapsibleSection';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { parseHandoffReport } from '../../utils/parseHandoffReport';
import type { HandoffReportParseResult } from '../../utils/parseHandoffReport';
import {
  countNonemptySubsections,
  extractH2Section,
  isHandoffSectionBodyEmpty,
} from '../../utils/handoffSectionContent';

export type HandoffReportViewVariant = 'timeline' | 'detail';

export interface HandoffReportViewProps {
  content: string;
  variant?: HandoffReportViewVariant;
}

type SectionKey = 'overview' | 'proofs' | 'direction' | 'systemDesign' | 'notes' | 'action';

interface SectionDef {
  id: string;
  label: string;
  key: SectionKey;
  defaultOpenWhenNonempty: boolean;
}

const STRUCTURED_SECTIONS: SectionDef[] = [
  { id: 'overview', label: 'Overview', key: 'overview', defaultOpenWhenNonempty: true },
  { id: 'proofs', label: 'Proofs', key: 'proofs', defaultOpenWhenNonempty: false },
  { id: 'direction', label: 'Direction', key: 'direction', defaultOpenWhenNonempty: false },
  {
    id: 'system-design',
    label: 'System Design',
    key: 'systemDesign',
    defaultOpenWhenNonempty: true,
  },
  { id: 'notes', label: 'Notes', key: 'notes', defaultOpenWhenNonempty: false },
  { id: 'action', label: 'Action required', key: 'action', defaultOpenWhenNonempty: true },
];

function computeSectionBodies(parsed: HandoffReportParseResult): {
  bodies: Record<SectionKey, string | null>;
  isAbsent: Record<string, boolean>;
} {
  const bodies: Record<SectionKey, string | null> = {
    overview: parsed.overview,
    proofs: parsed.proofs,
    direction: null,
    systemDesign: null,
    notes: parsed.notes,
    action: parsed.action,
  };
  const isAbsent: Record<string, boolean> = {};

  if (parsed.direction) {
    const { extracted, remainder } = extractH2Section(parsed.direction, 'System Design');
    bodies.systemDesign = extracted;
    bodies.direction = remainder || null;
    // systemDesign is absent if the heading was never in the direction body
    isAbsent['system-design'] = extracted === null;
  }

  return { bodies, isAbsent };
}

function StructuredView({ parsed }: { parsed: HandoffReportParseResult }) {
  const { bodies, isAbsent } = useMemo(() => computeSectionBodies(parsed), [parsed]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of STRUCTURED_SECTIONS) {
      const body = bodies[section.key];
      if (body === null && section.key !== 'direction') continue;
      if (section.key === 'systemDesign' && isAbsent['system-design']) continue;
      const isEmpty = isHandoffSectionBodyEmpty(body ?? null);
      initial[section.id] = isEmpty ? false : section.defaultOpenWhenNonempty;
    }
    return initial;
  });

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-2">
      {STRUCTURED_SECTIONS.map((section) => {
        const body = bodies[section.key];
        if (body === null && section.key !== 'direction') return null;
        if (section.key === 'systemDesign' && isAbsent['system-design']) return null;
        if (section.key === 'direction' && body === null) return null;
        const subsectionCount = countNonemptySubsections(body!);
        const isEmpty = isHandoffSectionBodyEmpty(body);
        const isOpen = openSections[section.id] ?? false;
        return (
          <HandoffCollapsibleSection
            key={section.id}
            id={section.id}
            label={section.label}
            body={body!}
            isOpen={isOpen}
            onToggle={() => toggleSection(section.id)}
            useActionMarkdown={section.key === 'action'}
            subsectionCount={subsectionCount}
            isEmpty={isEmpty}
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
