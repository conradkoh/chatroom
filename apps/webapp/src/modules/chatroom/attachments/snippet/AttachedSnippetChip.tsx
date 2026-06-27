'use client';

import { FileCode, X } from 'lucide-react';
import React, { useState } from 'react';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? path;
}

type AttachedSnippetChipCommon = {
  reference: string;
  fileSource: string;
  selectedContent: string;
};

type AttachedSnippetChipProps =
  | (AttachedSnippetChipCommon & { mode: 'editable'; onRemove: () => void })
  | (AttachedSnippetChipCommon & { mode: 'view' });

/**
 * Displays a single explorer file-snippet attachment as a chip.
 *
 * Supports two modes via a discriminated union on `mode`:
 * - `'view'` — read-only chip. Clicking opens a modal with full selected content.
 * - `'editable'` — includes an X remove button. `onRemove` is required.
 */
export function AttachedSnippetChip(props: AttachedSnippetChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const fileName = basename(props.fileSource);

  return (
    <>
      <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-tertiary border border-chatroom-border text-xs group hover:border-chatroom-border-strong transition-colors">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1.5 cursor-pointer focus:outline-none"
          aria-label="View attached snippet"
        >
          <FileCode size={12} className="text-chatroom-text-muted flex-shrink-0" />
          <span
            className="text-chatroom-text-secondary truncate max-w-[150px] hover:text-chatroom-text-primary transition-colors text-[10px] font-bold uppercase tracking-wider"
            title={props.fileSource}
          >
            {fileName}
          </span>
        </button>

        {
          // fallow-ignore-next-line code-duplication
          props.mode === 'editable' && (
            <button
              onClick={props.onRemove}
              className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors flex-shrink-0"
              aria-label="Remove attachment"
              type="button"
            >
              <X size={12} />
            </button>
          )
        }
      </div>

      <FixedModal isOpen={isOpen} onClose={() => setIsOpen(false)} maxWidth="max-w-2xl">
        <FixedModalContent>
          <FixedModalHeader onClose={() => setIsOpen(false)}>
            <div className="flex items-center gap-2">
              <FileCode size={14} className="text-chatroom-text-muted" />
              <FixedModalTitle>{fileName}</FixedModalTitle>
            </div>
          </FixedModalHeader>
          <FixedModalBody>
            <div className="p-4">
              <p className="mb-3 text-xs text-chatroom-text-muted font-mono break-all">
                {props.fileSource}
              </p>
              <pre className="p-4 bg-chatroom-bg-tertiary border border-chatroom-border text-sm text-chatroom-text-primary whitespace-pre-wrap font-mono overflow-x-auto">
                {props.selectedContent}
              </pre>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </>
  );
}
