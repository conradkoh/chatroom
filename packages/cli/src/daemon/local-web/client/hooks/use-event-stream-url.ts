import { useCallback, useEffect, useState } from 'react';

import { readChatroomIdFromSearch, replaceAppUrlParams } from '../lib/app-url';

export function useEventStreamUrl() {
  const [chatroomId, setChatroomIdState] = useState<string | undefined>(() =>
    readChatroomIdFromSearch(window.location.search)
  );
  const setChatroomId = useCallback((id: string | undefined) => {
    setChatroomIdState(id);
    replaceAppUrlParams({ chatroomId: id ?? null });
  }, []);
  useEffect(() => {
    const onPopState = () =>
      setChatroomIdState(readChatroomIdFromSearch(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return { chatroomId, setChatroomId };
}
