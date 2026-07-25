'use client';

import { useState } from 'react';

import { EnhancerDiffPanel } from './EnhancerDiffPanel';
import { TimelineMessageFooter } from '../../../components/timeline/TimelineMessageFooter';
import type { Message } from '../../../types/message';

interface EnhancerMessageDiffSectionProps {
  message: Message;
  displayContent: string;
  hasEnhancerOriginal: boolean;
}

/** Footer enhanced indicator + lazy-loaded diff panel for enhanced team messages. */
export function EnhancerMessageDiffSection({
  message,
  displayContent,
  hasEnhancerOriginal,
}: EnhancerMessageDiffSectionProps) {
  const [diffPanelOpen, setDiffPanelOpen] = useState(false);

  return (
    <>
      <TimelineMessageFooter
        message={message}
        displayContent={displayContent}
        isEnhanced={hasEnhancerOriginal}
        onEnhancedIconClick={() => setDiffPanelOpen(true)}
      />

      {hasEnhancerOriginal && (
        <EnhancerDiffPanel
          open={diffPanelOpen}
          onOpenChange={setDiffPanelOpen}
          originalContent={message.enhancerOriginalContent ?? ''}
          enhancedContent={message.content}
        />
      )}
    </>
  );
}
