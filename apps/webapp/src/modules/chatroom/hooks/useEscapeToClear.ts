import { useCallback } from 'react';

/**
 * Hook to intercept Escape key in dialogs with search input.
 *
 * When Escape is pressed and the input has text, clears the input
 * instead of dismissing the dialog. Only dismisses when input is empty.
 *
 * @param inputValueRef - Ref to the current input value
 * @param clearInput - Callback to clear the input
 * @returns onEscapeKeyDown handler for DialogPrimitive.Content
 */
export function useEscapeToClear(
  inputValueRef: React.RefObject<string>,
  clearInput: () => void
) {
  return useCallback(
    (e: KeyboardEvent) => {
      if (inputValueRef.current && inputValueRef.current.length > 0) {
        e.preventDefault();
        clearInput();
      }
      // If input is empty, let the default dismiss behavior happen
    },
    [inputValueRef, clearInput]
  );
}
