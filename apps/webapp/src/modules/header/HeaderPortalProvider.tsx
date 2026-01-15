'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/**
 * Header portal content structure.
 * Allows child components to inject content into different sections of the app header.
 */
interface HeaderPortalContent {
  /** Content to display on the left side of the header (after logo) */
  left?: ReactNode;
  /** Content to display in the center of the header */
  center?: ReactNode;
  /** Content to display on the right side of the header (before auth) */
  right?: ReactNode;
}

interface HeaderPortalContextValue {
  /** Current portal content */
  content: HeaderPortalContent;
  /** Set the portal content */
  setContent: (content: HeaderPortalContent) => void;
  /** Clear all portal content */
  clearContent: () => void;
}

const HeaderPortalContext = createContext<HeaderPortalContextValue | null>(null);

/**
 * Provider component that manages header portal content.
 * Wrap your app with this provider to enable header content injection.
 */
export function HeaderPortalProvider({ children }: { children: ReactNode }) {
  const [content, setContentState] = useState<HeaderPortalContent>({});

  const setContent = useCallback((newContent: HeaderPortalContent) => {
    setContentState(newContent);
  }, []);

  const clearContent = useCallback(() => {
    setContentState({});
  }, []);

  return (
    <HeaderPortalContext.Provider value={{ content, setContent, clearContent }}>
      {children}
    </HeaderPortalContext.Provider>
  );
}

/**
 * Hook to access the header portal content.
 * Used by the Navigation component to render injected content.
 */
export function useHeaderPortal(): HeaderPortalContent {
  const context = useContext(HeaderPortalContext);
  if (!context) {
    // Return empty content if provider is not available (e.g., during SSR)
    return {};
  }
  return context.content;
}

/**
 * Hook to set header portal content from child components.
 * Returns functions to set and clear portal content.
 */
export function useSetHeaderPortal() {
  const context = useContext(HeaderPortalContext);
  if (!context) {
    // Return no-op functions if provider is not available
    return {
      setContent: () => {},
      clearContent: () => {},
    };
  }
  return {
    setContent: context.setContent,
    clearContent: context.clearContent,
  };
}
