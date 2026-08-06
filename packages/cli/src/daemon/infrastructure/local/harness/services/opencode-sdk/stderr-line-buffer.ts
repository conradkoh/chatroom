/**
 * Accumulates stderr chunks and invokes a callback per complete line.
 */
export class StderrLineBuffer {
  private buffer = '';

  constructor(private readonly onLine: (line: string) => void) {}

  append(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.onLine(line);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onLine(this.buffer);
      this.buffer = '';
    }
  }
}
