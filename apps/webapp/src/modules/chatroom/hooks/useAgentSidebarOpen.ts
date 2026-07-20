'use client';

import { useCallback, useState } from 'react';

export function useAgentSidebarOpen(isSmallScreen: boolean | undefined): {
  visible: boolean;
  setVisible: (visible: boolean) => void;
  restoreDesktopDefault: () => void;
} {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopHidden, setDesktopHidden] = useState(false);

  const visible =
    isSmallScreen === true ? mobileOpen : isSmallScreen === false ? !desktopHidden : false;

  const setVisible = useCallback(
    (next: boolean) => {
      if (isSmallScreen) {
        setMobileOpen(next);
      } else {
        setDesktopHidden(!next);
      }
    },
    [isSmallScreen]
  );

  const restoreDesktopDefault = useCallback(() => {
    setDesktopHidden(false);
  }, []);

  return { visible, setVisible, restoreDesktopDefault };
}
