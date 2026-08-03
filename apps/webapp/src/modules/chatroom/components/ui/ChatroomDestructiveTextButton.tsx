'use client';

import type * as React from 'react';

import {
  chatroomDestructiveTextButtonColorsClassName,
  chatroomDestructiveTextButtonCompactClassName,
  chatroomDestructiveTextButtonIndustrialClassName,
} from '../shared/industrialDialogStyles';

import { cn } from '@/lib/utils';

export type ChatroomDestructiveTextButtonSize = 'compact' | 'industrial';

export function ChatroomDestructiveTextButton({
  size = 'compact',
  className,
  type = 'button',
  ...props
}: React.ComponentProps<'button'> & { size?: ChatroomDestructiveTextButtonSize }) {
  const layoutClassName =
    size === 'industrial'
      ? chatroomDestructiveTextButtonIndustrialClassName
      : chatroomDestructiveTextButtonCompactClassName;

  return (
    <button
      type={type}
      className={cn(chatroomDestructiveTextButtonColorsClassName, layoutClassName, className)}
      {...props}
    />
  );
}
