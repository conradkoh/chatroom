'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const toasterStyle = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--normal-bg-hover': 'var(--accent)',
  '--normal-border-hover': 'var(--border)',
  '--toast-close-button-start': 'unset',
  '--toast-close-button-end': 'unset',
  '--toast-close-button-transform': 'none',
} as React.CSSProperties;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'group toast items-center gap-2',
          closeButton:
            'static ml-auto shrink-0 !transform-none h-5 w-5 rounded-none border-0 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground',
        },
      }}
      style={toasterStyle}
      {...props}
    />
  );
};

export { Toaster };
