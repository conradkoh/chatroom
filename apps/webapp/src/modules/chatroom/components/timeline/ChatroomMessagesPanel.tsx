'use client';

import type React from 'react';

import {
  AllTabConversationPanel,
  type AllTabNavigationActions,
} from '../../features/all-tab-conversation/AllTabConversationPanel';
import { ConversationModeProvider } from '../../hooks/useConversationMode';

export interface ChatroomMessagesPanelProps {
  chatroomId: string;
  onRegisterAllTabNavigation?: (actions: AllTabNavigationActions) => void;
  onRequestComposerFocus?: () => void;
  /** Optional footer (MessageInput) rendered below feed */
  footer?: React.ReactNode;
}

export function ChatroomMessagesPanel({
  chatroomId,
  onRegisterAllTabNavigation,
  onRequestComposerFocus,
  footer,
}: ChatroomMessagesPanelProps) {
  return (
    <ConversationModeProvider chatroomId={chatroomId}>
      <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
        <AllTabConversationPanel
          chatroomId={chatroomId}
          onRegisterAllTabNavigation={onRegisterAllTabNavigation}
          onRequestComposerFocus={onRequestComposerFocus}
        />
        {footer ? <div className="shrink-0">{footer}</div> : null}
      </div>
    </ConversationModeProvider>
  );
}
