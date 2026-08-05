/** Localhost-only daemon UI server — not implemented. */
export type LocalWebServerConfig = {
  host: '127.0.0.1';
  port: number;
};

export function createLocalWebServer(_config: LocalWebServerConfig): { stop(): void } {
  return { stop() {} };
}
