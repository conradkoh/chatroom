// fallow-ignore-file unused-export
/**
 * fal pricing for the local asset commands.
 *
 * fal's generation API does not return a billed amount: `fal.subscribe` gives
 * back the result and a request id only. Every cost the CLI prints is therefore
 * an estimate computed locally as `unit price × billing quantity`.
 *
 * The live rate comes from fal's read-only pricing API when `FAL_API_KEY` is
 * set. Any failure (missing key, network, non-200, malformed body, endpoint not
 * listed) silently falls back to the hard-coded list price. This module never
 * throws for a lookup failure and never includes the key in an error or output.
 */

import { isRecord } from './local-image-common.js';

/** Date the hard-coded fallback rates were read from fal's model pages. */
export const LIST_PRICES_AS_OF = '2026-10-25';

export interface FalUnitPrice {
  endpointId: string;
  /** USD per unit. */
  unitPrice: number;
  /** Unit string exactly as fal reports it. */
  unit: string;
  rateSource: 'live' | 'list';
}

/** Hard-coded fallback rates, used only when the live lookup fails. */
export const LIST_PRICES: Readonly<Record<string, { unitPrice: number; unit: string }>> = {
  'fal-ai/flux-2/flash': { unitPrice: 0.005, unit: 'megapixels' },
  'fal-ai/flux-2/flash/edit': { unitPrice: 0.005, unit: 'processed megapixels' },
  'fal-ai/bria/background/remove': { unitPrice: 0.018, unit: 'generations' },
  'fal-ai/birefnet/v2': { unitPrice: 0.000575, unit: 'compute seconds' },
};

/**
 * Preset dimensions for fal's `image_size` strings, verified against
 * https://fal.ai/docs/documentation/model-apis/model-arguments (2026-10-25).
 * A preset missing here has no estimate; callers print the rate only.
 */
export const IMAGE_SIZE_PRESETS: Readonly<Record<string, { width: number; height: number }>> = {
  square_hd: { width: 1024, height: 1024 },
  square: { width: 512, height: 512 },
  portrait_4_3: { width: 768, height: 1024 },
  portrait_16_9: { width: 576, height: 1024 },
  landscape_4_3: { width: 1024, height: 768 },
  landscape_16_9: { width: 1024, height: 576 },
};

export interface FalPricingDeps {
  env: Record<string, string | undefined>;
  /**
   * GET a URL with headers and parse the JSON body. Injected for tests; the
   * default implementation is the only code in this module that uses the
   * network.
   */
  getJson: (url: string, headers: Record<string, string>, timeoutMs: number) => Promise<unknown>;
}

/** Timeout for the pricing lookup; the command must never hang on billing. */
export const PRICING_TIMEOUT_MS = 3000;

const PRICING_URL = 'https://api.fal.ai/v1/models/pricing';

function listPrice(endpointId: string): FalUnitPrice | undefined {
  const fallback = LIST_PRICES[endpointId];
  if (fallback === undefined) return undefined;
  return { endpointId, ...fallback, rateSource: 'list' };
}

function fallbackPrices(endpointIds: readonly string[]): Map<string, FalUnitPrice> {
  const prices = new Map<string, FalUnitPrice>();
  for (const endpointId of endpointIds) {
    const price = listPrice(endpointId);
    if (price !== undefined) prices.set(endpointId, price);
  }
  return prices;
}

/** Read one `prices[]` entry, ignoring entries that are malformed or not USD. */
// fallow-ignore-next-line complexity
function parseLivePrice(entry: unknown): FalUnitPrice | undefined {
  if (!isRecord(entry)) return undefined;
  const { endpoint_id, unit_price, unit, currency } = entry;
  if (typeof endpoint_id !== 'string' || endpoint_id.length === 0) return undefined;
  if (typeof unit_price !== 'number' || !Number.isFinite(unit_price) || unit_price < 0) {
    return undefined;
  }
  if (typeof unit !== 'string' || unit.length === 0) return undefined;
  if (currency !== undefined && currency !== 'USD') return undefined;
  return { endpointId: endpoint_id, unitPrice: unit_price, unit, rateSource: 'live' };
}

// fallow-ignore-next-line complexity
function livePricesByEndpoint(body: unknown): Map<string, FalUnitPrice> {
  const prices = new Map<string, FalUnitPrice>();
  if (!isRecord(body) || !Array.isArray(body.prices)) return prices;
  for (const entry of body.prices) {
    const price = parseLivePrice(entry);
    if (price !== undefined) prices.set(price.endpointId, price);
  }
  return prices;
}

/**
 * Look up one live unit price per endpoint id in a single request, falling back
 * to `LIST_PRICES` for every id the response does not cover.
 *
 * Never throws: a missing key skips the network entirely, and any lookup
 * failure returns list prices.
 */
// fallow-ignore-next-line complexity
export async function lookupFalUnitPrices(
  endpointIds: readonly string[],
  deps: FalPricingDeps
): Promise<Map<string, FalUnitPrice>> {
  const ids = [...new Set(endpointIds)];
  const key = deps.env.FAL_API_KEY?.trim();
  if (!key || ids.length === 0) return fallbackPrices(ids);

  try {
    const url = new URL(PRICING_URL);
    for (const endpointId of ids) url.searchParams.append('endpoint_id', endpointId);
    const body = await deps.getJson(
      url.toString(),
      { Authorization: `Key ${key}` },
      PRICING_TIMEOUT_MS
    );
    const live = livePricesByEndpoint(body);
    const prices = new Map<string, FalUnitPrice>();
    for (const endpointId of ids) {
      const price = live.get(endpointId) ?? listPrice(endpointId);
      if (price !== undefined) prices.set(endpointId, price);
    }
    return prices;
  } catch {
    // Billing disclosure must never fail a generation; fall back silently.
    return fallbackPrices(ids);
  }
}

/** USD estimate = quantity × unit price. No rounding. */
export function estimateUsd(price: FalUnitPrice, quantity: number): number {
  return quantity * price.unitPrice;
}

/**
 * Human formatting for a USD amount. Uses at least four decimal places and
 * extends them when needed so a non-zero cost never displays as `$0.00`.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return 'unknown';
  if (value === 0) return '$0';
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.min(12, Math.max(4, 3 - magnitude));
  return `$${value.toFixed(decimals)}`;
}

/** Megapixels for a fal `image_size` value: a preset name or explicit size. */
// fallow-ignore-next-line complexity
export function imageSizeMegapixels(
  imageSize: string | { width: number; height: number }
): number | undefined {
  if (typeof imageSize === 'string') {
    const preset = IMAGE_SIZE_PRESETS[imageSize];
    if (preset === undefined) return undefined;
    return (preset.width * preset.height) / 1_000_000;
  }
  if (
    !Number.isFinite(imageSize.width) ||
    !Number.isFinite(imageSize.height) ||
    imageSize.width <= 0 ||
    imageSize.height <= 0
  ) {
    return undefined;
  }
  return (imageSize.width * imageSize.height) / 1_000_000;
}

/** The rate and where it came from, for a `Cost:` line. */
export function formatRate(price: FalUnitPrice): string {
  return `${formatUsd(price.unitPrice)} per ${price.unit}`;
}

export function formatRateSource(price: FalUnitPrice): string {
  return price.rateSource === 'live'
    ? 'live rate for this account'
    : `list price as of ${LIST_PRICES_AS_OF}; live lookup unavailable`;
}

/** `$0.005 per megapixels (live rate…) × 0.79 MP ≈ $0.003930` */
export function formatCostEstimate(
  price: FalUnitPrice,
  quantity: number,
  quantityLabel: string
): string {
  return `${formatRate(price)} (${formatRateSource(price)}) × ${quantityLabel} ≈ ${formatUsd(estimateUsd(price, quantity))}`;
}

/**
 * A command's cost disclosure. `estimate` has a quantity, `rate-only` has a
 * rate but no defensible total (for example runtime-billed models), and
 * `unknown` has no rate data for the model at all.
 */
export type FalCostDisclosure =
  | {
      kind: 'estimate';
      model: string;
      price: FalUnitPrice;
      quantity: number;
      quantityLabel: string;
    }
  | { kind: 'rate-only'; model: string; price: FalUnitPrice; reason: string }
  | { kind: 'unknown'; model: string };

/**
 * One `Cost:` line. Callers pass `Estimated cost` for the post-call line and
 * add their own explanatory notes; this function stays arithmetic-only so the
 * two commands word their caveats correctly.
 */
export function formatCostDisclosure(
  disclosure: FalCostDisclosure,
  label: 'Cost' | 'Estimated cost' = 'Cost'
): string {
  if (disclosure.kind === 'unknown') {
    return `${label}: unknown for ${disclosure.model}; no rate data.`;
  }
  if (disclosure.kind === 'rate-only') {
    return `${label} (rate only): ${formatRate(disclosure.price)} (${formatRateSource(disclosure.price)}). ${disclosure.reason}`;
  }
  return `${label} (estimate): ${formatCostEstimate(disclosure.price, disclosure.quantity, disclosure.quantityLabel)}`;
}

/** Default network implementation; only this function sends the API key. */
export function createDefaultFalPricingDeps(
  env: Record<string, string | undefined> = process.env
): FalPricingDeps {
  return {
    env,
    getJson: async (url, headers, timeoutMs) => {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        // Never include the response body or request headers: the key lives in
        // Authorization, and a verbose error could echo it.
        throw new Error(`fal pricing lookup failed (HTTP ${response.status})`);
      }
      return (await response.json()) as unknown;
    },
  };
}
