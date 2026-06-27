'use client';

import { useCallback, useMemo, useState } from 'react';

import { getAttachmentChipPreviewLine } from './attachmentChipUtils';

/** Chip preview line + modal open state shared by attachment chip components. */
export function useAttachmentChipPreview(content: string) {
  const [isOpen, setIsOpen] = useState(false);
  const { firstLine, displayText } = useMemo(
    () => getAttachmentChipPreviewLine(content),
    [content]
  );
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return { isOpen, open, close, firstLine, displayText };
}
