'use client';

import { useCallback, useState } from 'react';

export function usePickerSearchState(onOpenChange: (open: boolean) => void) {
  const [searchTerm, setSearchTerm] = useState('');

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setSearchTerm('');
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  return { searchTerm, setSearchTerm, handleOpenChange };
}
