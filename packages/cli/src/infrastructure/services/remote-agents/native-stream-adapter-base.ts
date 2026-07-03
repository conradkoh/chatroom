import { createAssistantTextCapture } from './assistant-text-capture.js';

type AgentEndCallback = () => void;
type OutputCallback = () => void;

/** Shared callback wiring for cursor-sdk and pi-sdk stream adapters. */
export abstract class NativeStreamAdapterBase {
  protected readonly agentEndCallbacks: AgentEndCallback[] = [];
  protected readonly outputCallbacks: OutputCallback[] = [];
  protected agentEndEmitted = false;
  protected readonly assistantTextCapture = createAssistantTextCapture();

  constructor(
    protected readonly logPrefix: string,
    protected readonly emitLogLine?: (line: string) => void
  ) {}

  setAssistantTextCapture(cb: (text: string) => void): void {
    this.assistantTextCapture.setAssistantTextCapture(cb);
  }

  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  onOutput(cb: OutputCallback): void {
    this.outputCallbacks.push(cb);
  }

  protected notifyOutput(): void {
    for (const cb of this.outputCallbacks) cb();
  }

  protected writeLine(line: string): void {
    this.emitLogLine?.(line);
  }
}
