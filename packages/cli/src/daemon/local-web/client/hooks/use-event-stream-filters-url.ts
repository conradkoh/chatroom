import { useCallback, useEffect, useState } from 'react';
import type { EventStreamFilterValues } from '../lib/event-stream-filters-url';
import { readEventStreamFiltersFromSearch, replaceEventStreamFiltersInUrl } from '../lib/event-stream-filters-url';
export function useEventStreamFiltersFromUrl() {
  const [filters, setState] = useState<EventStreamFilterValues>(() => readEventStreamFiltersFromSearch(window.location.search));
  const setFilters = useCallback((v: EventStreamFilterValues) => { setState(v); replaceEventStreamFiltersInUrl(v); }, []);
  useEffect(() => { const onPopState = () => setState(readEventStreamFiltersFromSearch(window.location.search)); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);
  return { filters, setFilters };
}
