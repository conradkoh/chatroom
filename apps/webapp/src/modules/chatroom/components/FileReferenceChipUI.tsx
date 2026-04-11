'use client';

import { FileText } from 'lucide-react';
import React from 'react';

// ============================================================================
// Shared File Reference Chip Styling
// ============================================================================

/**
 * Base Tailwind classes shared by all file reference chip renderings
 * (React component in message history + raw HTML in contenteditable input).
 *
 * Uses the polished message-chip design as the canonical style:
 * bg-chatroom-bg-tertiary, text-xs, font-mono, rounded-sm, align-middle.
 */
export const FILE_REF_CHIP_BASE_CLASSES =
  'inline-flex items-center gap-1 px-1.5 py-0.5 bg-chatroom-bg-tertiary border border-chatroom-border text-chatroom-text-primary text-xs font-mono rounded-sm align-middle';

/**
 * Raw SVG string of Lucide's FileText icon at 12x12.
 * Used in HTML contexts (e.g. contenteditable) where React components can't render.
 */
export const FILE_REF_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" style="color: var(--chatroom-text-muted);"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;

// ============================================================================
// React Component (for message history rendering)
// ============================================================================

/**
 * Purely presentational file reference chip.
 * No click handling — consumers wrap this with their own interaction logic.
 */
export function FileReferenceChipUI({
  fileName,
  filePath,
  className,
}: {
  fileName: string;
  filePath?: string;
  className?: string;
}) {
  return (
    <span
      className={`${FILE_REF_CHIP_BASE_CLASSES}${className ? ` ${className}` : ''}`}
      title={filePath}
    >
      <FileText size={12} className="shrink-0 text-chatroom-text-muted" />
      <span className="truncate max-w-[200px]">{fileName}</span>
    </span>
  );
}

// ============================================================================
// Raw HTML builder (for contenteditable contexts)
// ============================================================================

/**
 * Build raw HTML for a file reference chip in contenteditable contexts.
 *
 * Preserves the critical `contenteditable="false"` and `data-file-ref` attributes
 * that `htmlToRawText` relies on for serializer round-trip.
 *
 * @param rawToken - The raw `{file://workspace/path}` token stored as data-file-ref
 * @param fileName - Display name shown in the chip
 */
export function buildFileRefChipHtml(rawToken: string, fileName: string): string {
  const escaped = escapeAttr(rawToken);
  return `<span contenteditable="false" data-file-ref="${escaped}" class="${FILE_REF_CHIP_BASE_CLASSES} mr-1 cursor-default select-none">${FILE_REF_ICON_SVG} <span class="truncate" style="max-width: 200px;">${escapeHtml(fileName)}</span></span>`;
}

// ============================================================================
// HTML escaping helpers (duplicated from fileReferenceSerializer to keep
// this module self-contained; they are tiny pure functions)
// ============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
