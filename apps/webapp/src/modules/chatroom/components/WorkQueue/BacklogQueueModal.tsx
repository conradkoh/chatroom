'use client';

import { ChevronRight, X } from 'lucide-react';
import React, { useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { type BacklogItem, getScoringBadge, getBacklogStatusBadge } from '../backlog';
import { compactMarkdownComponents } from '../markdown-utils';

// Backlog Queue Modal Component - shows all backlog items
export interface BacklogQueueModalProps {
  items: BacklogItem[];
  onClose: () => void;
  onItemClick: (item: BacklogItem) => void;
}

export function BacklogQueueModal({ items, onClose, onItemClick }: BacklogQueueModalProps) {
  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  React.useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />

      {/* Modal */}
      <div className="fixed inset-x-2 top-16 bottom-2 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[95%] md:max-w-xl md:max-h-[70vh] bg-chatroom-bg-primary border-2 border-chatroom-border-strong z-50 flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface flex-shrink-0">
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            Active Backlog ({items.length} items)
          </span>
          <button
            className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-9 h-9 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Backlog Item List */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {items.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">
              No active backlog items
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item._id}
                className="flex items-start gap-3 p-3 hover:bg-chatroom-bg-hover transition-colors cursor-pointer group border-b border-chatroom-border last:border-b-0"
                onClick={() => onItemClick(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onItemClick(item);
                  }
                }}
              >
                {/* Status Badge - reflects actual item status */}
                {(() => {
                  const itemBadge = getBacklogStatusBadge(item.status);
                  return (
                    <span
                      className={`flex-shrink-0 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${itemBadge.classes}`}
                    >
                      {itemBadge.label}
                    </span>
                  );
                })()}

                {/* Scoring badges */}
                {(item.complexity || item.value || item.priority !== undefined) && (
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {item.priority !== undefined && (
                      <span className="px-1 py-0.5 text-[8px] font-bold bg-chatroom-accent/15 text-chatroom-accent">
                        P:{item.priority}
                      </span>
                    )}
                    {item.complexity && (
                      <span
                        className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('complexity', item.complexity).classes}`}
                      >
                        {getScoringBadge('complexity', item.complexity).label}
                      </span>
                    )}
                    {item.value && (
                      <span
                        className={`px-1 py-0.5 text-[8px] font-bold ${getScoringBadge('value', item.value).classes}`}
                      >
                        {getScoringBadge('value', item.value).label}
                      </span>
                    )}
                  </div>
                )}

                {/* Content - with markdown */}
                <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-3">
                  <Markdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={compactMarkdownComponents}
                  >
                    {item.content}
                  </Markdown>
                </div>

                {/* Arrow */}
                <ChevronRight
                  size={14}
                  className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
                />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
