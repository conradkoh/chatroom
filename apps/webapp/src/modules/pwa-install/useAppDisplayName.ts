'use client';

import { useEffect, useState } from 'react';

const DEFAULT_APP_NAME = 'App';

/** Reads application name from layout metadata meta tag. */
export function useAppDisplayName(): string {
  const [name, setName] = useState(DEFAULT_APP_NAME);

  useEffect(() => {
    const content = document
      .querySelector('meta[name="application-name"]')
      ?.getAttribute('content')
      ?.trim();
    if (content) setName(content);
  }, []);

  return name;
}
