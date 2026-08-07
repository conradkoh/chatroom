import type { NativeStreamAdapterBase } from './native-stream-adapter-base.js';

/** Wire shared stream-adapter callbacks for cursor-sdk and pi-sdk turn loops. */
export function wireNativeStreamAdapter(args: {
  adapter: NativeStreamAdapterBase;
  assistantTextCallbacks: ((text: string) => void)[];
  outputCallbacks: (() => void)[];
  agentEndCallbacks: (() => void)[];
  entry: { lastOutputAt: number };
}): void {
  args.adapter.setAssistantTextCapture((text) => {
    for (const cb of args.assistantTextCallbacks) cb(text);
  });
  args.adapter.onOutput(() => {
    args.entry.lastOutputAt = Date.now();
    for (const cb of args.outputCallbacks) cb();
  });
  args.adapter.onAgentEnd(() => {
    for (const cb of args.agentEndCallbacks) cb();
  });
}
