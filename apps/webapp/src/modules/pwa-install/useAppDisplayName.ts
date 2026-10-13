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
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-initialize-state -- intentional: the name lives in the layout meta tag, readable only from the DOM after mount; SSR keeps DEFAULT_APP_NAME
    if (content) setName(content);
  }, []);

  return name;
}
