'use client';

import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { parseHandoffEnvelope } from '../../utils/parseHandoffEnvelope';

export type HandoffEnvelopeViewVariant = 'timeline' | 'detail';

export interface HandoffEnvelopeViewProps {
  content: string;
  variant?: HandoffEnvelopeViewVariant;
}

function previewText(text: string, maxLen = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= maxLen ? oneLine : `${oneLine.slice(0, maxLen)}…`;
}

export const HandoffEnvelopeView = memo(function HandoffEnvelopeView({
  content,
  variant = 'timeline',
}: HandoffEnvelopeViewProps) {
  const parsed = useMemo(() => parseHandoffEnvelope(content), [content]);
  const [expanded, setExpanded] = useState(variant === 'detail');
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

  const userPreview = parsed.sections.find((s) => s.id === 'user-message')?.body ?? '';

  return (
    <div data-testid="handoff-envelope-view" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {variant === 'timeline' && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-text-primary"
            aria-expanded={expanded}
            data-testid="handoff-envelope-toggle"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{parsed.sections.length} sections</span>
            {!expanded && userPreview && (
              <span className="font-normal normal-case text-chatroom-text-secondary ml-1">
                — {previewText(userPreview)}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[10px] font-bold uppercase tracking-wider text-chatroom-status-info hover:underline"
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
      ) : expanded ? (
        <div className="space-y-2" data-testid="handoff-envelope-sections">
          {parsed.preamble && (
            <div className="text-xs text-chatroom-text-muted italic border-l-2 border-chatroom-border pl-3">
              <TimelineMarkdownBody content={parsed.preamble} />
            </div>
          )}
          {parsed.sections.map((section) => {
            const isOpen = openSections.has(section.id);
            return (
              <div
                key={section.id}
                className="border border-chatroom-border overflow-hidden"
                data-testid={`handoff-section-${section.id}`}
              >
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:bg-chatroom-bg-hover"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {section.label}
                </button>
                {isOpen && (
                  <div className="px-3 py-2 border-t border-chatroom-border">
                    <TimelineMarkdownBody content={section.body} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
