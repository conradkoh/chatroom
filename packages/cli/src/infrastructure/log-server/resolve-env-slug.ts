export function resolveEnvSlug(convexUrl: string): string {
  try {
    const url = new URL(convexUrl);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return 'local';
    const slug = host.split('.')[0].replace(/[^a-z0-9-]/g, '-');
    return slug || 'default';
  } catch {
    return 'default';
  }
}
