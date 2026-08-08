'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { composerAccessoryButtonClassName } from './composerAccessoryButtonStyles';

import { cn } from '@/lib/utils';

export type ComposerAccessoryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  children: ReactNode;
};

export const ComposerAccessoryButton = forwardRef<HTMLButtonElement, ComposerAccessoryButtonProps>(
  function ComposerAccessoryButton({ icon, children, className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(composerAccessoryButtonClassName, className)}
        {...props}
      >
        {icon}
        <span>{children}</span>
      </button>
    );
  }
);
