'use client';

import type React from 'react';

import type { MachineNameEntry } from './timelineRowStyles';
import {
  AllTabConversationPanel,
  type AllTabNavigationActions,
} from '../../features/all-tab-conversation/AllTabConversationPanel';
import { ConversationModeProvider } from '../../hooks/useConversationMode';

export interface ChatroomMessagesPanelProps {
  chatroomId: string;
  machines?: Map<string, MachineNameEntry>;
  onRegisterAllTabNavigation?: (actions: AllTabNavigationActions) => void;
  /** Optional footer (MessageInput) rendered below feed */
  footer?: React.ReactNode;
}

export function ChatroomMessagesPanel({
  chatroomId,
  machines,
  onRegisterAllTabNavigation,
  footer,
}: ChatroomMessagesPanelProps) {
  return (
    <ConversationModeProvider chatroomId={chatroomId}>
      <div className="flex-1 flex flex-col min-h-0 h-full overflow-hidden">
        <AllTabConversationPanel
          chatroomId={chatroomId}
          machines={machines}
          onRegisterAllTabNavigation={onRegisterAllTabNavigation}
        />
        {footer ? <div className="shrink-0">{footer}</div> : null}
      </div>
    </ConversationModeProvider>
  );
}
