import type { KeyboardEvent } from 'react';

export function createChatroomSelectKeyDown(onSelect: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };
}
