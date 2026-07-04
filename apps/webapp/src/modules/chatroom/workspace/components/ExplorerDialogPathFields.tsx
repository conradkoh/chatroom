'use client';

import type { KeyboardEvent, RefObject } from 'react';

import { handleDialogSaveKeyDown } from './explorerDialogInputUtils';
import {
  chatroomIndustrialInputClassName,
  chatroomIndustrialInputErrorClassName,
} from '../../components/shared/industrialDialogStyles';

import { cn } from '@/lib/utils';

interface ExplorerDialogPathFieldsProps {
  isNested: boolean;
  targetDir: string;
  nestedValue: string;
  onNestedChange: (value: string) => void;
  pathValue: string;
  onPathChange: (value: string) => void;
  nestedPlaceholder: string;
  rootPlaceholder: string;
  nestedAriaLabel: string;
  rootAriaLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  validationError: string | null;
  onSave: () => void;
}

// fallow-ignore-next-line complexity
export function ExplorerDialogPathFields({
  isNested,
  targetDir,
  nestedValue,
  onNestedChange,
  pathValue,
  onPathChange,
  nestedPlaceholder,
  rootPlaceholder,
  nestedAriaLabel,
  rootAriaLabel,
  inputRef,
  validationError,
  onSave,
}: ExplorerDialogPathFieldsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    handleDialogSaveKeyDown(event, onSave);
  };

  return (
    <div className="space-y-2">
      {isNested ? (
        <div
          className={cn(
            'flex items-center overflow-hidden rounded-none border bg-chatroom-bg-secondary',
            validationError ? chatroomIndustrialInputErrorClassName : 'border-chatroom-border'
          )}
        >
          <span
            className="shrink-0 border-r border-chatroom-border px-3 py-2 text-sm font-mono text-chatroom-text-muted select-none"
            aria-hidden
          >
            {targetDir}/
          </span>
          <input
            ref={inputRef}
            value={nestedValue}
            onChange={(event) => onNestedChange(event.target.value)}
            placeholder={nestedPlaceholder}
            aria-label={nestedAriaLabel}
            className="h-9 w-full border-0 bg-transparent px-3 text-sm text-chatroom-text-primary outline-none placeholder:text-chatroom-text-muted"
            onKeyDown={onKeyDown}
          />
        </div>
      ) : (
        <input
          ref={inputRef}
          value={pathValue}
          onChange={(event) => onPathChange(event.target.value)}
          placeholder={rootPlaceholder}
          aria-label={rootAriaLabel}
          className={cn(
            'h-9 w-full px-3 text-sm',
            chatroomIndustrialInputClassName,
            validationError && chatroomIndustrialInputErrorClassName
          )}
          onKeyDown={onKeyDown}
        />
      )}
      {validationError && <p className="text-xs text-chatroom-status-error">{validationError}</p>}
    </div>
  );
}
