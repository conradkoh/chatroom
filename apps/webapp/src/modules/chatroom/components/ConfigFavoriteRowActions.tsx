'use client';

import { ArrowUp, ArrowDown, X } from 'lucide-react';
import { memo } from 'react';

export interface ConfigFavoriteRowActionsProps {
  disabled?: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export const ConfigFavoriteRowActions = memo(function ConfigFavoriteRowActions({
  disabled = false,
  onMoveUp,
  onMoveDown,
  onRemove,
}: ConfigFavoriteRowActionsProps) {
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={onMoveUp}
        className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary disabled:opacity-30"
        title="Move up"
        aria-label="Move up"
      >
        <ArrowUp size={12} />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onMoveDown}
        className="p-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary disabled:opacity-30"
        title="Move down"
        aria-label="Move down"
      >
        <ArrowDown size={12} />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        className="p-0.5 text-chatroom-text-muted hover:text-chatroom-status-error disabled:opacity-30"
        title="Remove favorite"
        aria-label="Remove favorite"
      >
        <X size={12} />
      </button>
    </>
  );
});
