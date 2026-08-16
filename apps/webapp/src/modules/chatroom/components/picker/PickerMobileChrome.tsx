'use client';
import type { ReactNode } from 'react';

import { usePickerShell } from './PickerShellContext';

export function PickerMobileChrome({ children }: { children: ReactNode }) {
  return usePickerShell().mobileKeyboardOpen ? null : <>{children}</>;
}
