export type AssistantChunkRow = {
  _creationTime: number;
  content: string;
  partType?: 'text' | 'reasoning' | string;
};

export function aggregateAssistantChunks(
  chunks: readonly AssistantChunkRow[],
  turnStartedAt: number,
  upperBound: number
): { textContent: string; reasoningContent: string } {
  let textContent = '';
  let reasoningContent = '';
  for (const chunk of chunks) {
    const chunkTime = chunk._creationTime;
    if (chunkTime < turnStartedAt || chunkTime >= upperBound) continue;
    const partType = chunk.partType ?? 'text';
    if (partType === 'text') textContent += chunk.content;
    else if (partType === 'reasoning') reasoningContent += chunk.content;
  }
  return { textContent, reasoningContent };
}
