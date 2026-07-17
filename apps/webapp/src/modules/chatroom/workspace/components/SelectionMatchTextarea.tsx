'use client';

import { useRef } from 'react';
import type { MouseEventHandler } from 'react';

import { useSelectionMatchHighlights } from '../hooks/useSelectionMatchHighlights';
import { buildMirrorHighlightSegments } from '../utils/buildMirrorHighlightSegments';

import { cn } from '@/lib/utils';

interface SelectionMatchTextareaProps {
  content: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onContextMenu?: MouseEventHandler<HTMLTextAreaElement>;
}

export function SelectionMatchTextarea({
  content,
  placeholder,
  ariaLabel,
  onChange,
  onContextMenu,
}: SelectionMatchTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { mirrorRef, highlightRanges, handleScroll, handleSelectionUpdate } =
    useSelectionMatchHighlights(content, textareaRef);

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <pre
        ref={mirrorRef}
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre-wrap break-words p-4',
          'font-mono text-[13px] leading-relaxed text-chatroom-text-primary'
        )}
      >
        {buildMirrorHighlightSegments(content, highlightRanges)}
      </pre>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => {
          onChange(event.target.value);
          handleSelectionUpdate();
        }}
        onContextMenu={onContextMenu}
        onScroll={handleScroll}
        onSelect={handleSelectionUpdate}
        onKeyUp={handleSelectionUpdate}
        onMouseUp={handleSelectionUpdate}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          'relative z-10 flex-1 min-h-0 h-full w-full resize-none bg-transparent p-4',
          'font-mono text-[13px] leading-relaxed text-transparent caret-chatroom-text-primary',
          'selection:bg-chatroom-accent/30',
          'placeholder:italic placeholder:text-chatroom-text-muted placeholder:[-webkit-text-fill-color:var(--chatroom-text-muted)]',
          'outline-none border-0'
        )}
        aria-label={ariaLabel}
      />
    </div>
  );
}
