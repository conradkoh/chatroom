export function parseModelId(model: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined;
  const slashIdx = model.indexOf('/');
  if (slashIdx === -1) return undefined;
  const providerID = model.substring(0, slashIdx);
  const modelID = model.substring(slashIdx + 1);
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function forwardFiltered(
  source: NodeJS.ReadableStream | undefined,
  target: NodeJS.WritableStream,
  shouldDrop: (line: string) => boolean
): void {
  if (!source) return;
  let buf = '';
  source.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!shouldDrop(line)) target.write(line + '\n');
    }
  });
  source.on('end', () => {
    if (buf.length > 0 && !shouldDrop(buf)) target.write(buf);
    buf = '';
  });
}

export const isInfoLine = (line: string): boolean => line.trimStart().startsWith('INFO ');
