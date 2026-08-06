/** Shared assistant-text capture hook for native harness stream adapters. */
export function createAssistantTextCapture() {
  let onAssistantText: ((text: string) => void) | undefined;

  return {
    setAssistantTextCapture(cb: (text: string) => void): void {
      onAssistantText = cb;
    },
    captureAssistantText(text: string): void {
      onAssistantText?.(text);
    },
  };
}
