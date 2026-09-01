import { createAssistantTextCapture } from './assistant-text-capture.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivityEmitter,
} from '../../../agent-process-manager/harness-activity-emitter.js';

type AgentEndCallback = () => void;
type OutputCallback = () => void;

/** Shared callback wiring for cursor-sdk and pi-sdk stream adapters. */
export abstract class NativeStreamAdapterBase {
  protected readonly agentEndCallbacks: AgentEndCallback[] = [];
  protected readonly outputCallbacks: OutputCallback[] = [];
  protected agentEndEmitted = false;
  protected readonly assistantTextCapture = createAssistantTextCapture();
  public readonly activityEmitter: HarnessActivityEmitter;

  constructor(
    protected readonly logPrefix: string,
    protected readonly emitLogLine?: (line: string) => void,
    activityEmitter: HarnessActivityEmitter = createHarnessActivityEmitter()
  ) {
    this.activityEmitter = activityEmitter;
  }

  setAssistantTextCapture(cb: (text: string) => void): void {
    this.assistantTextCapture.setAssistantTextCapture(cb);
  }

  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  onOutput(cb: OutputCallback): void {
    this.outputCallbacks.push(cb);
  }

  protected notifyOutput(source = 'native-sdk.event'): void {
    this.activityEmitter.emit({
      kind: 'transport',
      source,
      at: Date.now(),
    });
    for (const cb of this.outputCallbacks) cb();
  }

  protected notifyProgress(source: string): void {
    this.activityEmitter.emit({
      kind: 'progress',
      source,
      at: Date.now(),
    });
  }

  protected notifyWaiting(source: string): void {
    this.activityEmitter.emit({
      kind: 'waiting',
      source,
      at: Date.now(),
    });
  }

  protected notifyFailure(source: string): void {
    this.activityEmitter.emit({
      kind: 'failure',
      source,
      at: Date.now(),
    });
  }

  protected writeLine(line: string): void {
    this.emitLogLine?.(line);
  }
}
