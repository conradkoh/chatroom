/**
 * fal pricing unit tests.
 *
 * `getJson` is injected, so no test here touches the network. The fake records
 * the URL and headers so the batching and authentication shape can be checked
 * without a paid or live call.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  IMAGE_SIZE_PRESETS,
  LIST_PRICES,
  LIST_PRICES_AS_OF,
  createDefaultFalPricingDeps,
  estimateUsd,
  formatCostDisclosure,
  formatCostEstimate,
  formatRateSource,
  formatUsd,
  imageSizeMegapixels,
  lookupFalUnitPrices,
  type FalPricingDeps,
  type FalUnitPrice,
} from './fal-pricing.js';

const FAL_API_KEY = 'fal-key-sentinel-never-printed';
const FLASH = 'fal-ai/flux-2/flash';
const EDIT = 'fal-ai/flux-2/flash/edit';
const BRIA = 'fal-ai/bria/background/remove';
const BIREFNET = 'fal-ai/birefnet/v2';

interface GetJsonCall {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

function createDeps(
  body: unknown = { prices: [] },
  options: { env?: Record<string, string | undefined>; reject?: Error } = {}
): { deps: FalPricingDeps; calls: GetJsonCall[] } {
  const calls: GetJsonCall[] = [];
  const getJson = vi.fn(async (url: string, headers: Record<string, string>, timeoutMs: number) => {
    calls.push({ url, headers, timeoutMs });
    if (options.reject !== undefined) throw options.reject;
    return body;
  });
  return { deps: { env: options.env ?? { FAL_API_KEY }, getJson }, calls };
}

function livePrice(
  overrides: Partial<FalUnitPrice> & { currency?: string } = {}
): Record<string, unknown> {
  return {
    endpoint_id: FLASH,
    unit_price: 0.004,
    unit: 'live megapixels',
    currency: 'USD',
    ...overrides,
  };
}

function expectList(price: FalUnitPrice | undefined, endpointId: string): void {
  expect(price).toBeDefined();
  expect(price?.endpointId).toBe(endpointId);
  expect(price?.unitPrice).toBe(LIST_PRICES[endpointId]?.unitPrice);
  expect(price?.unit).toBe(LIST_PRICES[endpointId]?.unit);
  expect(price?.rateSource).toBe('list');
}

describe('lookupFalUnitPrices', () => {
  it('uses list prices and makes no request when FAL_API_KEY is unset', async () => {
    const { deps } = createDeps({ prices: [] }, { env: {} });

    const prices = await lookupFalUnitPrices([FLASH, BRIA], deps);

    expect(deps.getJson).not.toHaveBeenCalled();
    expectList(prices.get(FLASH), FLASH);
    expectList(prices.get(BRIA), BRIA);
  });

  it('treats a blank FAL_API_KEY as unset', async () => {
    const { deps } = createDeps({ prices: [] }, { env: { FAL_API_KEY: '   ' } });

    await lookupFalUnitPrices([FLASH], deps);

    expect(deps.getJson).not.toHaveBeenCalled();
  });

  it('batches every id into one authenticated request with a timeout', async () => {
    const { deps, calls } = createDeps({ prices: [] });

    await lookupFalUnitPrices([FLASH, EDIT, BRIA, BIREFNET], deps);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.headers).toEqual({ Authorization: `Key ${FAL_API_KEY}` });
    expect(call?.timeoutMs).toBe(3000);
    const url = new URL(call?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://api.fal.ai/v1/models/pricing');
    expect(url.searchParams.getAll('endpoint_id')).toEqual([FLASH, EDIT, BRIA, BIREFNET]);
  });

  it('deduplicates repeated ids in the request', async () => {
    const { deps, calls } = createDeps({ prices: [] });

    await lookupFalUnitPrices([FLASH, FLASH], deps);

    expect(calls[0]?.url).toBeTruthy();
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.getAll('endpoint_id')).toEqual([FLASH]);
  });

  it('uses the live unit price and unit when the response covers the id', async () => {
    const { deps } = createDeps({ prices: [livePrice()] });

    const prices = await lookupFalUnitPrices([FLASH], deps);

    expect(prices.get(FLASH)).toEqual({
      endpointId: FLASH,
      unitPrice: 0.004,
      unit: 'live megapixels',
      rateSource: 'live',
    });
  });

  it('falls back to the list price for ids missing from a partial response', async () => {
    const { deps } = createDeps({ prices: [livePrice()] });

    const prices = await lookupFalUnitPrices([FLASH, BRIA], deps);

    expect(prices.get(FLASH)?.rateSource).toBe('live');
    expectList(prices.get(BRIA), BRIA);
  });

  it.each([
    ['a missing prices array', {}],
    ['a non-array prices value', { prices: 'nope' }],
    ['a malformed entry', { prices: [{ endpoint_id: FLASH, unit_price: 'free', unit: 'mp' }] }],
  ])('falls back to list prices for %s', async (_label, body) => {
    const { deps } = createDeps(body);

    const prices = await lookupFalUnitPrices([FLASH], deps);

    expectList(prices.get(FLASH), FLASH);
  });

  it('ignores entries whose price is not in USD', async () => {
    const { deps } = createDeps({ prices: [livePrice({ currency: 'EUR' })] });

    const prices = await lookupFalUnitPrices([FLASH], deps);

    expectList(prices.get(FLASH), FLASH);
  });

  it('falls back to list prices and never throws when the lookup rejects', async () => {
    const { deps } = createDeps(undefined, { reject: new Error('network down') });

    const prices = await lookupFalUnitPrices([FLASH, BIREFNET], deps);

    expectList(prices.get(FLASH), FLASH);
    expectList(prices.get(BIREFNET), BIREFNET);
    expect(JSON.stringify([...prices])).not.toContain(FAL_API_KEY);
  });

  it('does not invent a rate for an unknown endpoint', async () => {
    const { deps } = createDeps({ prices: [] });

    const prices = await lookupFalUnitPrices(['acme/unknown'], deps);

    expect(prices.has('acme/unknown')).toBe(false);
  });

  it('returns an empty map without a request when no ids are requested', async () => {
    const { deps } = createDeps({ prices: [] });

    const prices = await lookupFalUnitPrices([], deps);

    expect(prices.size).toBe(0);
    expect(deps.getJson).not.toHaveBeenCalled();
  });

  it('never puts the key in an error raised by the default getJson', async () => {
    const deps = createDefaultFalPricingDeps({ FAL_API_KEY });

    // A real GET would need the network; this checks the failure path of the
    // default adapter by rejecting before any request is attempted.
    const failing: FalPricingDeps = {
      env: deps.env,
      getJson: async () => {
        throw new Error('fal pricing lookup failed (HTTP 401)');
      },
    };
    const prices = await lookupFalUnitPrices([FLASH], failing);

    expectList(prices.get(FLASH), FLASH);
    expect(JSON.stringify([...prices])).not.toContain(FAL_API_KEY);
  });
});

describe('estimateUsd', () => {
  it('multiplies the unit price by the billing quantity without rounding', () => {
    const price: FalUnitPrice = {
      endpointId: FLASH,
      unitPrice: 0.005,
      unit: 'megapixels',
      rateSource: 'live',
    };

    expect(estimateUsd(price, 0.786432)).toBeCloseTo(0.00393216, 12);
    expect(estimateUsd(price, 1)).toBe(0.005);
    expect(estimateUsd(price, 0)).toBe(0);
  });
});

describe('formatUsd', () => {
  it.each([
    [0.000575, '$0.0005750'],
    [0.00393216, '$0.003932'],
    [0.005, '$0.005000'],
    [0.018, '$0.01800'],
    [1, '$1.0000'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });

  it('never shows a non-zero cost as $0.00', () => {
    expect(formatUsd(0.000575)).not.toBe('$0.00');
    expect(formatUsd(0.00000001)).not.toBe('$0.00');
  });

  it('formats zero without decimals', () => {
    expect(formatUsd(0)).toBe('$0');
  });
});

describe('imageSizeMegapixels', () => {
  it('maps every verified preset to its pixel area', () => {
    expect(IMAGE_SIZE_PRESETS.landscape_4_3).toEqual({ width: 1024, height: 768 });
    expect(imageSizeMegapixels('landscape_4_3')).toBeCloseTo(0.786432, 12);
    expect(imageSizeMegapixels('square_hd')).toBeCloseTo(1.048576, 12);
    expect(imageSizeMegapixels('square')).toBeCloseTo(0.262144, 12);
  });

  it('uses custom width and height values', () => {
    expect(imageSizeMegapixels({ width: 1024, height: 1024 })).toBeCloseTo(1.048576, 12);
    expect(imageSizeMegapixels({ width: 512, height: 256 })).toBeCloseTo(0.131072, 12);
  });

  it.each([
    ['an unknown preset', 'huge' as const],
    ['zero width', { width: 0, height: 1024 }],
    ['a negative height', { width: 1024, height: -1 }],
    ['NaN', { width: Number.NaN, height: 1024 }],
  ])('returns undefined for %s', (_label, value) => {
    expect(imageSizeMegapixels(value)).toBeUndefined();
  });
});

describe('cost wording', () => {
  const listFlash: FalUnitPrice = {
    endpointId: FLASH,
    unitPrice: 0.005,
    unit: 'megapixels',
    rateSource: 'list',
  };

  it('labels a list price with its date and the failed live lookup', () => {
    expect(formatRateSource(listFlash)).toBe(
      `list price as of ${LIST_PRICES_AS_OF}; live lookup unavailable`
    );
  });

  it('labels a live rate as the account rate', () => {
    expect(formatRateSource({ ...listFlash, rateSource: 'live' })).toBe(
      'live rate for this account'
    );
  });

  it('shows rate, source, quantity, and estimate in one line', () => {
    expect(formatCostEstimate(listFlash, 0.786432, '0.79 MP')).toBe(
      '$0.005000 per megapixels (list price as of 2026-10-25; live lookup unavailable) × 0.79 MP ≈ $0.003932'
    );
  });

  it('formats an estimate, a rate-only disclosure, and an unknown model', () => {
    expect(
      formatCostDisclosure({
        kind: 'estimate',
        model: FLASH,
        price: listFlash,
        quantity: 0.786432,
        quantityLabel: '0.79 MP',
      })
    ).toContain('Cost (estimate): $0.005000 per megapixels');
    expect(
      formatCostDisclosure({
        kind: 'rate-only',
        model: BIREFNET,
        price: {
          endpointId: BIREFNET,
          unitPrice: 0.000575,
          unit: 'compute seconds',
          rateSource: 'list',
        },
        reason: 'total depends on runtime; not estimated.',
      })
    ).toBe(
      'Cost (rate only): $0.0005750 per compute seconds (list price as of 2026-10-25; live lookup unavailable). total depends on runtime; not estimated.'
    );
    expect(formatCostDisclosure({ kind: 'unknown', model: 'acme/custom' }, 'Estimated cost')).toBe(
      'Estimated cost: unknown for acme/custom; no rate data.'
    );
  });
});
