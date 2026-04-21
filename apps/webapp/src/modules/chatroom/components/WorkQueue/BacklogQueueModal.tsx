'use client';

import { ChevronRight } from 'lucide-react';
import React from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { type BacklogItem, getScoringBadge, getBacklogStatusBadge } from '../backlog';
import { compactMarkdownComponents } from '../markdown-utils';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
} from '@/components/ui/fixed-modal';

// Backlog Queue Modal Component - shows all backlog items
export interface BacklogQueueModalProps {
  items: BacklogItem[];
  onClose: () => void;
  onItemClick: (item: BacklogItem) => void;
}

export function BacklogQueueModal({ items, onClose, onItemClick }: BacklogQueueModalProps) {
  return (
    <FixedModal isOpen onClose={onClose} maxWidth="max-w-xl" className="sm:max-h-[70vh]">
      <FixedModalContent>
        <FixedModalHeader onClose={onClose} className="py-4">
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary">
            Backlog ({items.length} items)
          </span>
        </FixedModalHeader>

        <FixedModalBody className="p-0">
          {items.length === 0 ? (
            <div className="p-8 text-center text-chatroom-text-muted text-sm">No backlog items</div>
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

                <div className="flex-1 min-w-0 text-xs text-chatroom-text-primary line-clamp-3">
                  <Markdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={compactMarkdownComponents}
                  >
                    {item.content}
                  </Markdown>
                </div>

                <ChevronRight
                  size={14}
                  className="flex-shrink-0 text-chatroom-text-muted opacity-0 group-hover:opacity-100 transition-all"
                />
              </div>
            ))
          )}
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
}
