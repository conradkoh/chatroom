/**
 * Upload URL guard shared by every CLI uploader that POSTs bytes to a Convex HTTP action.
 *
 * The upload POST carries the session bearer token (attachments) or backup bytes, so only send
 * it to the configured backend origin. Two Convex conventions are also accepted: the production
 * site origin paired with a `<name>.convex.cloud` backend (`<name>.convex.site`), and the local
 * site port (cloud port + 1) next to a loopback backend, where local HTTP actions are served.
 *
 * Pure: the caller supplies the backend URL and the error factory, so each caller keeps its own
 * error type.
 */

const CONVEX_CLOUD_SUFFIX = '.convex.cloud';
const CONVEX_SITE_SUFFIX = '.convex.site';

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** True when `uploadPort` is the Convex site port next to `backendPort`. */
function isConvexLocalSitePort(uploadPort: string, backendPort: string): boolean {
  return uploadPort !== '' && backendPort !== '' && Number(uploadPort) === Number(backendPort) + 1;
}

function parseUploadUrl(
  uploadUrl: string,
  backendUrl: string,
  rejected: (message: string) => Error
): { upload: URL; backend: URL } {
  try {
    return { upload: new URL(uploadUrl), backend: new URL(backendUrl) };
  } catch {
    throw rejected('Upload URL is not a valid URL');
  }
}

function isSupportedUploadProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

function requiresHttps(upload: URL): boolean {
  return upload.protocol === 'http:' && !isLoopbackHostname(upload.hostname);
}

/** HTTPS is required unless the upload targets loopback (local Convex). */
function assertUploadProtocol(upload: URL, rejected: (message: string) => Error): void {
  if (!isSupportedUploadProtocol(upload.protocol)) {
    throw rejected(`Upload URL uses an unsupported protocol: ${upload.protocol}`);
  }
  if (requiresHttps(upload)) {
    throw rejected('Upload URL must use HTTPS unless it targets loopback');
  }
}

/**
 * Convex local dev serves HTTP actions on the port after the cloud port. Any
 * two loopback hosts qualify (for example localhost and 127.0.0.1), because
 * the port pairing identifies the same local deployment.
 */
function isConvexLocalSiteUrl(upload: URL, backend: URL): boolean {
  return (
    isLoopbackHostname(upload.hostname) &&
    isLoopbackHostname(backend.hostname) &&
    isConvexLocalSitePort(upload.port, backend.port)
  );
}

/** Production Convex serves HTTP actions on `<name>.convex.site`, paired with `<name>.convex.cloud`. */
function isConvexCloudSiteUrl(upload: URL, backend: URL): boolean {
  if (backend.protocol !== 'https:' || backend.port !== '') return false;
  if (!backend.hostname.endsWith(CONVEX_CLOUD_SUFFIX)) return false;

  const siteOrigin = `https://${backend.hostname.slice(
    0,
    -CONVEX_CLOUD_SUFFIX.length
  )}${CONVEX_SITE_SUFFIX}`;
  return upload.origin === siteOrigin;
}

/** Throws unless the upload URL is safe to POST a bearer token or backup bytes to. */
export function assertUploadUrlAllowed(
  uploadUrl: string,
  backendUrl: string,
  rejected: (message: string) => Error
): void {
  const { upload, backend } = parseUploadUrl(uploadUrl, backendUrl, rejected);

  assertUploadProtocol(upload, rejected);
  if (
    upload.origin === backend.origin ||
    isConvexLocalSiteUrl(upload, backend) ||
    isConvexCloudSiteUrl(upload, backend)
  ) {
    return;
  }

  throw rejected(
    `Upload URL origin ${upload.origin} does not match the configured backend ${backend.origin}`
  );
}
