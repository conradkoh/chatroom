'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

export interface WorkQueueDeleteButtonProps {
  /** Single tap deletes. Resolves when the delete finishes. */
  onDelete: () => Promise<void> | void;
  title?: string;
}

/** Single-tap delete for a work-queue row; no confirmation step. */
export function WorkQueueDeleteButton({ onDelete, title = 'Delete' }: WorkQueueDeleteButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, onDelete]);

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isDeleting}
      aria-busy={isDeleting || undefined}
      className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 disabled:opacity-50"
      title={title}
    >
      <Trash2 size={14} />
    </button>
  );
}
