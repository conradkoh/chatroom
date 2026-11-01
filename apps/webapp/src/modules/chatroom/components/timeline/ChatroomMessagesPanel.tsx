'use client';

import type React from 'react';

import {
  ConversationPanel,
  type AllTabNavigationActions,
} from '../../features/conversation/ConversationPanel';
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
        <ConversationPanel
          chatroomId={chatroomId}
          onRegisterAllTabNavigation={onRegisterAllTabNavigation}
          onRequestComposerFocus={onRequestComposerFocus}
        />
        {footer ? <div className="shrink-0">{footer}</div> : null}
      </div>
    </ConversationModeProvider>
  );
}
