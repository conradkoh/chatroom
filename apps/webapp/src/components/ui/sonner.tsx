'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const toasterStyle = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--normal-bg-hover': 'var(--accent)',
  '--normal-border-hover': 'var(--border)',
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
          toast: 'group toast !flex !w-full items-center gap-2',
          content: 'flex-1 min-w-0',
          closeButton:
            'sonner-close-button order-last !static shrink-0 !transform-none !h-5 !w-5 !rounded-none !border-0 !bg-transparent !text-muted-foreground hover:!bg-transparent hover:!text-foreground',
        },
      }}
      style={toasterStyle}
      {...props}
    />
  );
};

export { Toaster };
