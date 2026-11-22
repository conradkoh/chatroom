'use client';

import { MessageFileAttachments } from '../../features/file-attachments/components/MessageFileAttachments';
import type { Message } from '../../types/message';

/** File attachments for a handoff; the wrapper owns spacing and the null case. */
export function TimelineFileAttachments({
  files,
  showMedia,
  className,
}: {
  files: Message['attachedFiles'];
  showMedia: boolean;
  className?: string;
}) {
  if (!files?.length) return null;
  return (
    <div className={className}>
      <MessageFileAttachments files={files} showMedia={showMedia} />
    </div>
  );
}
