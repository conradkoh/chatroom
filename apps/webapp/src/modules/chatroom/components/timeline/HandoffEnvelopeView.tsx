'use client';

import { AlertTriangle } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { HandoffCollapsibleSection } from './HandoffCollapsibleSection';
import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { parseHandoffEnvelope } from '../../utils/parseHandoffEnvelope';

export type HandoffEnvelopeViewVariant = 'timeline' | 'detail';

export interface HandoffEnvelopeViewProps {
  content: string;
  variant?: HandoffEnvelopeViewVariant;
}

export const HandoffEnvelopeView = memo(function HandoffEnvelopeView({
  content,
  variant = 'timeline',
}: HandoffEnvelopeViewProps) {
  const parsed = useMemo(() => parseHandoffEnvelope(content), [content]);
  const [showRaw, setShowRaw] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(() =>
    variant === 'detail' ? new Set(parsed.sections.map((s) => s.id)) : new Set()
  );

  const toggleSection = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div data-testid="handoff-envelope-view" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[10px] font-bold tracking-wide text-chatroom-status-info hover:underline"
          data-testid="handoff-raw-toggle"
        >
          {showRaw ? 'Structured' : 'Raw'}
        </button>
        {parsed.warnings.length > 0 && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-chatroom-status-warning"
            title={parsed.warnings.join('; ')}
            data-testid="handoff-envelope-warnings"
          >
            <AlertTriangle size={10} />
            {parsed.warnings.length} warning{parsed.warnings.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {showRaw ? (
        <pre
          className="text-xs font-mono whitespace-pre-wrap break-words bg-chatroom-bg-tertiary border border-chatroom-border p-3 max-h-96 overflow-y-auto"
          data-testid="handoff-raw-content"
        >
          {content}
        </pre>
      ) : (
        <div className="space-y-2" data-testid="handoff-envelope-sections">
          {parsed.preamble && (
            <div className="text-xs text-chatroom-text-muted italic border-l-2 border-chatroom-border pl-3">
              <TimelineMarkdownBody content={parsed.preamble} />
            </div>
          )}
          {parsed.sections.map((section) => {
            const isOpen = openSections.has(section.id);
            return (
              <HandoffCollapsibleSection
                key={section.id}
                id={section.id}
                label={section.label}
                body={section.body}
                isOpen={isOpen}
                onToggle={() => toggleSection(section.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});
