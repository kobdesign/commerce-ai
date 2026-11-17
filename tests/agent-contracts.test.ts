import { describe, expect, it } from 'vitest';
import {
  AgentContractAuthorizationError,
  agentApiErrorSemantics,
  agentApiErrorSchema,
  agentApiOperations,
  authorizeAgentQuery,
  commerceAgentAudience,
  commerceAgentContractVersion,
  inventoryReadResponseSchema,
  productQuerySchema,
  productReadResponseSchema,
  salesQuerySchema,
} from '@commerce/agent-contracts';

const tenantId = '10000000-0000-4000-8000-000000000001';
const principalId = '20000000-0000-4000-8000-000000000001';
const shopA = '30000000-0000-4000-8000-000000000001';
const shopB = '30000000-0000-4000-8000-000000000002';
const productId = '40000000-0000-4000-8000-000000000001';
const variantId = '50000000-0000-4000-8000-000000000001';
const requestId = '60000000-0000-4000-8000-000000000001';
const now = '2026-11-13T06:00:00.000Z';

function context(overrides: Record<string, unknown> = {}) {
  return {
    tenantId, principalId, allowedShopIds: [shopA],
    scopes: ['catalog:read', 'sales:read', 'inventory:read'],
    audience: commerceAgentAudience, environment: 'staging', requestId,
    authenticatedAt: '2026-11-13T05:59:00.000Z', expiresAt: '2026-11-13T06:59:00.000Z',
    ...overrides,
  };
}

const variantEvidence = {
  kind: 'variant', ref: `variant:${variantId}`, observedAt: now,
  sourceVersion: 'catalog-v1', integrityHash: null,
} as const;

describe('read-only Commerce Agent API contracts', () => {
  it('defines only bounded query operations without tenant IDs in model input', () => {
    expect(Object.values(agentApiOperations).map(operation => [operation.method, operation.effect, operation.path])).toEqual([
      ['POST', 'read', '/api/agent/v1/products/query'],
      ['POST', 'read', '/api/agent/v1/sales/query'],
      ['POST', 'read', '/api/agent/v1/inventory/query'],
    ]);
    expect(productQuerySchema.safeParse({ shopIds: [shopA], tenantId }).success).toBe(false);
    expect(productQuerySchema.parse({ shopIds: [shopA] })).toMatchObject({ limit: 25, cursor: null, status: 'active' });
    expect(productQuerySchema.safeParse({ shopIds: [shopA], limit: 101 }).success).toBe(false);
    expect(productQuerySchema.safeParse({ shopIds: Array.from({ length: 21 }, (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`) }).success).toBe(false);
  });

  it('bounds sales history to 93 calendar days and validates real dates', () => {
    expect(salesQuerySchema.safeParse({ shopIds: [shopA], period: { from: '2026-08-13', to: '2026-11-13' } }).success).toBe(true);
    expect(salesQuerySchema.safeParse({ shopIds: [shopA], period: { from: '2026-08-12', to: '2026-11-13' } }).success).toBe(false);
    expect(salesQuerySchema.safeParse({ shopIds: [shopA], period: { from: '2026-02-30', to: '2026-03-01' } }).success).toBe(false);
  });

  it('requires the verified scope and rejects shops outside the service delegation', () => {
    const authorized = authorizeAgentQuery(context(), 'inventory.query', { shopIds: [shopA] });
    expect(authorized.definition.requiredScope).toBe('inventory:read');
    expect(() => authorizeAgentQuery(context({ scopes: ['catalog:read'] }), 'inventory.query', { shopIds: [shopA] }))
      .toThrowError(expect.objectContaining<Partial<AgentContractAuthorizationError>>({ code: 'SCOPE_FORBIDDEN' }));
    expect(() => authorizeAgentQuery(context(), 'products.query', { shopIds: [shopB] }))
      .toThrowError(expect.objectContaining<Partial<AgentContractAuthorizationError>>({ code: 'SHOP_FORBIDDEN' }));
  });

  it('requires evidence, snapshot versions and internally consistent pagination', () => {
    const response = {
      contractVersion: commerceAgentContractVersion, requestId, resource: 'products', asOf: now,
      dataVersion: 'catalog-snapshot:42', isSynthetic: true, scope: { shopIds: [shopA] },
      page: { limit: 25, returned: 1, hasMore: false, nextCursor: null }, limitations: [],
      items: [{
        productId, variantId, name: 'Chino Shorts', sku: 'CHI-S', category: 'Apparel', salesUnit: 'ตัว',
        attributes: { size: 'S' }, priceMinor: 59000, currency: 'THB', archived: false,
        listedShopIds: [shopA], evidence: [variantEvidence],
      }],
    };
    expect(productReadResponseSchema.parse(response).items).toHaveLength(1);
    expect(productReadResponseSchema.safeParse({ ...response, items: [{ ...response.items[0], evidence: [] }] }).success).toBe(false);
    expect(productReadResponseSchema.safeParse({ ...response, page: { ...response.page, returned: 0 } }).success).toBe(false);
    expect(productReadResponseSchema.safeParse({ ...response, page: { ...response.page, hasMore: true } }).success).toBe(false);
    expect(productReadResponseSchema.safeParse({ ...response, items: [{ ...response.items[0], listedShopIds: [shopB] }] }).success).toBe(false);
  });

  it('enforces stock arithmetic and prevents channel data outside response scope', () => {
    const response = {
      contractVersion: commerceAgentContractVersion, requestId, resource: 'inventory', asOf: now,
      dataVersion: 'inventory-snapshot:7', isSynthetic: true, scope: { shopIds: [shopA] },
      page: { limit: 25, returned: 1, hasMore: false, nextCursor: null }, limitations: ['Published quantity is not connected'],
      items: [{
        productId, variantId, productName: 'Chino Shorts', sku: 'CHI-S', onHand: 100, reserved: 20,
        available: 80, safetyStock: 10, distributable: 70, distributionMode: 'hybrid', balanceVersion: 7,
        channels: [{ shopId: shopA, channel: 'tiktok', mapped: true, configuredQuantity: 50, publishedQuantity: null, syncedAt: null }],
        evidence: [{ ...variantEvidence, kind: 'inventory_balance', ref: `inventory-balance:${variantId}`, sourceVersion: 'inventory-ledger-v1' }],
      }],
    };
    expect(inventoryReadResponseSchema.parse(response).items[0].distributable).toBe(70);
    expect(inventoryReadResponseSchema.safeParse({ ...response, items: [{ ...response.items[0], available: 81 }] }).success).toBe(false);
    expect(inventoryReadResponseSchema.safeParse({ ...response, items: [{ ...response.items[0], channels: [{ ...response.items[0].channels[0], shopId: shopB }] }] }).success).toBe(false);
  });

  it('uses stable, bounded and non-diagnostic public errors', () => {
    const error = agentApiErrorSchema.parse({
      contractVersion: commerceAgentContractVersion, requestId,
      error: { code: 'SHOP_FORBIDDEN', message: 'Requested shop is not available', retryable: false, fieldIssues: [] },
    });
    expect(error.error.code).toBe('SHOP_FORBIDDEN');
    expect(agentApiErrorSemantics).toMatchObject({
      SHOP_FORBIDDEN: { status: 403, retryable: false },
      RATE_LIMITED: { status: 429, retryable: true },
      INTERNAL_ERROR: { status: 500, retryable: true },
    });
    expect(agentApiErrorSchema.safeParse({
      contractVersion: commerceAgentContractVersion, requestId,
      error: { code: 'SHOP_FORBIDDEN', message: 'x'.repeat(241), retryable: false, fieldIssues: [], stack: 'secret' },
    }).success).toBe(false);
  });
});
