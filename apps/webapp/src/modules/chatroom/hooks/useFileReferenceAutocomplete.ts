'use client';

import { useCallback, useMemo, type RefObject } from 'react';

import type { FileEntry } from '../components/FileSelector/useFileSelector';
import { createFileReferenceTrigger } from '../triggers/fileReferenceTrigger';
import { useTriggerAutocomplete } from './useTriggerAutocomplete';
import { getTextareaCaretOffsetInContainer } from '../utils/textareaCaretPosition';

export interface UseFileReferenceAutocompleteOptions {
  files: FileEntry[];
  hasWorkspace?: boolean;
  onAtTriggerActivate?: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  text: string;
  onTextChange: (text: string) => void;
  onAfterUpdate?: () => void;
}

export function useFileReferenceAutocomplete({
  files,
  hasWorkspace = false,
  onAtTriggerActivate,
  textareaRef,
  anchorRef,
  text,
  onTextChange,
  onAfterUpdate,
}: UseFileReferenceAutocompleteOptions) {
  const fileRefTrigger = useMemo(
    () =>
      createFileReferenceTrigger(files, {
        onActivate: onAtTriggerActivate,
        hasWorkspace,
      }),
    [files, hasWorkspace, onAtTriggerActivate]
  );
  const triggers = useMemo(() => [fileRefTrigger], [fileRefTrigger]);

  const getCaretPosition = useCallback(() => {
    const textarea = textareaRef.current;
    const anchor = anchorRef.current;
    if (!textarea || !anchor) return null;
    const offset = getTextareaCaretOffsetInContainer(textarea, anchor);
    if (!offset) return null;
    return { top: offset.height + 4, left: offset.left, height: offset.height };
  }, [textareaRef, anchorRef]);

  const autocomplete = useTriggerAutocomplete<FileEntry>(triggers, { getCaretPosition });

  const applySelection = useCallback(
    (item: FileEntry) => {
      const { newText, newCursorPos, keepOpen } = autocomplete.handleSelect(item, text);
      onTextChange(newText);
      onAfterUpdate?.();
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
        if (keepOpen) {
          autocomplete.handleInputChange(newText, newCursorPos);
        }
      }, 0);
    },
    [autocomplete, text, onTextChange, onAfterUpdate, textareaRef]
  );

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onTextChange(newValue);
      const cursorPos = e.target.selectionStart ?? newValue.length;
      autocomplete.handleInputChange(newValue, cursorPos);
      onAfterUpdate?.();
    },
    [onTextChange, autocomplete, onAfterUpdate]
  );

  const handleAutocompleteKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!autocomplete.state.visible) return false;
      if (autocomplete.handleKeyDown(e.nativeEvent)) return true;
      if (
        (e.key === 'Enter' || e.key === 'Tab') &&
        autocomplete.state.results.length > 0 &&
        autocomplete.state.selectedIndex < autocomplete.state.results.length
      ) {
        e.preventDefault();
        const selectedItem = autocomplete.state.results[autocomplete.state.selectedIndex];
        if (selectedItem) applySelection(selectedItem);
        return true;
      }
      return false;
    },
    [autocomplete, applySelection]
  );

  const handleFileSelect = useCallback(
    (filePath: string) => {
      const fileEntry = autocomplete.state.results.find((f) => f.path === filePath);
      if (fileEntry) applySelection(fileEntry);
    },
    [autocomplete.state.results, applySelection]
  );

  return {
    autocompleteState: autocomplete.state,
    handleTextareaChange,
    handleAutocompleteKeyDown,
    handleFileSelect,
    setSelectedIndex: autocomplete.setSelectedIndex,
  };
}
