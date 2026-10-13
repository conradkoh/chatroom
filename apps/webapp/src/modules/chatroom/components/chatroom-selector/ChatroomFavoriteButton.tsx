'use client';

import { Star } from 'lucide-react';
import type { MouseEvent } from 'react';

interface ChatroomFavoriteButtonProps {
  isFavorite?: boolean;
  onClick: (event: MouseEvent) => void;
}

/** Star toggle for a chatroom's favourite flag. The caller decides what the click does. */
export function ChatroomFavoriteButton({ isFavorite, onClick }: ChatroomFavoriteButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center transition-all duration-100 ${
        isFavorite
          ? 'text-yellow-500 hover:text-yellow-400'
          : 'text-chatroom-text-muted hover:text-yellow-500'
      }`}
      title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
    </button>
  );
}
