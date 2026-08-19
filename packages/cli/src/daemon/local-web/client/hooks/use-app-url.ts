import { useCallback, useEffect, useState } from 'react';

import { readTabFromSearch, replaceAppUrlParams, type AppTab } from '../lib/app-url';

export function useAppUrl() {
  const [activeTab, setActiveTabState] = useState<AppTab>(() =>
    readTabFromSearch(window.location.search)
  );
  const setActiveTab = useCallback((tab: AppTab) => {
    setActiveTabState(tab);
    replaceAppUrlParams({ tab });
  }, []);
  useEffect(() => {
    const onPopState = () => setActiveTabState(readTabFromSearch(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return { activeTab, setActiveTab };
}
