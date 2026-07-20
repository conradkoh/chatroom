'use client';

import { Maximize2, Minimize2 } from 'lucide-react';
import { memo } from 'react';

export interface ChatroomFocusModeToggleProps {
  focusModeActive: boolean;
  onToggle: () => void;
}

export const ChatroomFocusModeToggle = memo(function ChatroomFocusModeToggle({
  focusModeActive,
  onToggle,
}: ChatroomFocusModeToggleProps) {
  return (
    <button
      type="button"
      className="shrink-0 ml-0.5 bg-transparent border-0 p-0 cursor-pointer text-chatroom-text-muted hover:text-chatroom-text-secondary transition-colors duration-100 outline-none focus:outline-none focus-visible:outline-none"
      onClick={onToggle}
      title={focusModeActive ? 'Disable focus mode' : 'Enable focus mode'}
      aria-label={focusModeActive ? 'Disable focus mode' : 'Enable focus mode'}
      aria-pressed={focusModeActive}
    >
      {focusModeActive ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
    </button>
  );
});
