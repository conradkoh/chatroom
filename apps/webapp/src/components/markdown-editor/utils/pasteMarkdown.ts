export function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/m.test(text) || /^```/m.test(text) || /^\s*[-*+]\s/m.test(text) ||
    /^\s*\d+\.\s/m.test(text) || /\*\*[^*]+\*\*/.test(text) || /`[^`]+`/.test(text)
  );
}
