'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

/** Reads ?error= from URL, shows toast, and clears the param without reload. */
export function SearchParamsErrorHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams.get('error');
    if (!error) return;
    toast.error(decodeURIComponent(error));
    const url = new URL(window.location.href);
    url.searchParams.delete('error');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams]);

  return null;
}
