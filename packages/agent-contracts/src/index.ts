import { z } from 'zod';

/**
 * Transport-neutral contracts for read-only Commerce Agent APIs.
 *
 * Tenant identity is deliberately absent from all tool input schemas. The Core
 * must derive it from a verified service identity and pass it in the trusted
 * request context defined below.
 */
export const commerceAgentContractVersion = 'commerce-agent-read-v1' as const;
export const commerceAgentAudience = 'commerce-agent-api' as const;
export const agentReadScopes = ['catalog:read', 'sales:read', 'inventory:read'] as const;
export type AgentReadScope = typeof agentReadScopes[number];

const uuid = z.string().uuid();
const isoTimestamp = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const uniqueUuids = (max: number) => z.array(uuid).min(1).max(max).refine(values => new Set(values).size === values.length, 'IDs must be unique');
const opaqueCursor = z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/, 'Cursor must be opaque base64url').nullable();
const versionTag = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const agentRequestContextSchema = z.object({
  tenantId: uuid,
  principalId: uuid,
  allowedShopIds: uniqueUuids(50),
  scopes: z.array(z.enum(agentReadScopes)).min(1).max(agentReadScopes.length)
    .refine(values => new Set(values).size === values.length, 'Scopes must be unique'),
  audience: z.literal(commerceAgentAudience),
  environment: z.enum(['development', 'staging', 'production']),
  requestId: z.string().uuid(),
  authenticatedAt: isoTimestamp,
  expiresAt: isoTimestamp,
}).strict();
export type AgentRequestContext = z.infer<typeof agentRequestContextSchema>;

const pageInput = z.object({
  cursor: opaqueCursor.default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

const shopScopedQuery = pageInput.extend({
  shopIds: uniqueUuids(20),
  asOf: isoTimestamp.optional(),
}).strict();

export const productQuerySchema = shopScopedQuery.extend({
  search: z.string().trim().max(100).default(''),
  category: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  variantIds: uniqueUuids(100).optional(),
}).strict();
export type ProductQuery = z.infer<typeof productQuerySchema>;

const salesPeriod = z.object({ from: isoDate, to: isoDate }).strict().superRefine((value, ctx) => {
  if (value.from > value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Period end must not precede start' });
  const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000;
  if (days > 92) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Sales period must not exceed 93 calendar days' });
});

export const salesQuerySchema = shopScopedQuery.extend({
  period: salesPeriod,
  variantIds: uniqueUuids(100).optional(),
  granularity: z.enum(['variant', 'variant_channel', 'variant_day']).default('variant'),
  orderStates: z.array(z.enum(['open', 'completed', 'cancelled'])).min(1).max(3)
    .refine(values => new Set(values).size === values.length, 'Order states must be unique')
    .default(['completed']),
}).strict();
export type SalesQuery = z.infer<typeof salesQuerySchema>;

export const inventoryQuerySchema = shopScopedQuery.extend({
  search: z.string().trim().max(100).default(''),
  variantIds: uniqueUuids(100).optional(),
  availability: z.enum(['all', 'available', 'low', 'out', 'reserved']).default('all'),
  includeChannelAllocation: z.boolean().default(true),
}).strict();
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

export const evidenceKinds = [
  'product', 'variant', 'channel_listing', 'sales_aggregate', 'inventory_balance', 'inventory_policy',
] as const;
export const evidenceReferenceSchema = z.object({
  kind: z.enum(evidenceKinds),
  ref: z.string().min(3).max(240).regex(/^[a-z][a-z0-9_-]*:[A-Za-z0-9._-]+$/),
  observedAt: isoTimestamp,
  sourceVersion: versionTag,
  integrityHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
}).strict();
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

const evidenceList = z.array(evidenceReferenceSchema).min(1).max(25)
  .refine(items => new Set(items.map(item => item.ref)).size === items.length, 'Evidence references must be unique');
const moneyMinor = z.number().int().min(0).max(9_000_000_000_000);

export const productReadItemSchema = z.object({
  productId: uuid,
  variantId: uuid,
  name: boundedText(150),
  sku: boundedText(64),
  category: boundedText(80),
  salesUnit: boundedText(40),
  attributes: z.record(z.string().min(1).max(40), z.string().max(80)).refine(value => Object.keys(value).length <= 15),
  priceMinor: moneyMinor,
  currency: z.literal('THB'),
  archived: z.boolean(),
  listedShopIds: uniqueUuids(20),
  evidence: evidenceList,
}).strict();
export type ProductReadItem = z.infer<typeof productReadItemSchema>;

export const salesReadItemSchema = z.object({
  productId: uuid,
  variantId: uuid,
  sku: boundedText(64),
  productName: boundedText(150),
  shopId: uuid.nullable(),
  channel: z.enum(['tiktok', 'shopee', 'lazada', 'direct', 'mixed']),
  period: salesPeriod,
  quantity: z.number().int().min(0).max(1_000_000_000),
  orderCount: z.number().int().min(0).max(1_000_000_000),
  grossSalesMinor: moneyMinor,
  currency: z.literal('THB'),
  evidence: evidenceList,
}).strict();
export type SalesReadItem = z.infer<typeof salesReadItemSchema>;

export const inventoryChannelSchema = z.object({
  shopId: uuid,
  channel: z.enum(['tiktok', 'shopee', 'lazada', 'direct']),
  mapped: z.boolean(),
  configuredQuantity: z.number().int().min(0).max(1_000_000_000).nullable(),
  publishedQuantity: z.number().int().min(0).max(1_000_000_000).nullable(),
  syncedAt: isoTimestamp.nullable(),
}).strict();

export const inventoryReadItemSchema = z.object({
  productId: uuid,
  variantId: uuid,
  productName: boundedText(150),
  sku: boundedText(64),
  onHand: z.number().int().min(0).max(1_000_000_000),
  reserved: z.number().int().min(0).max(1_000_000_000),
  available: z.number().int().min(0).max(1_000_000_000),
  safetyStock: z.number().int().min(0).max(1_000_000_000),
  distributable: z.number().int().min(0).max(1_000_000_000),
  distributionMode: z.enum(['shared', 'fixed', 'hybrid']),
  balanceVersion: z.number().int().min(0),
  channels: z.array(inventoryChannelSchema).max(20),
  evidence: evidenceList,
}).strict().superRefine((value, ctx) => {
  if (value.available !== Math.max(0, value.onHand - value.reserved)) {
    ctx.addIssue({ code: 'custom', path: ['available'], message: 'Available must equal max(0, onHand - reserved)' });
  }
  if (value.distributable !== Math.max(0, value.available - value.safetyStock)) {
    ctx.addIssue({ code: 'custom', path: ['distributable'], message: 'Distributable must equal max(0, available - safetyStock)' });
  }
});
export type InventoryReadItem = z.infer<typeof inventoryReadItemSchema>;

const responseMetadata = z.object({
  contractVersion: z.literal(commerceAgentContractVersion),
  requestId: z.string().uuid(),
  asOf: isoTimestamp,
  dataVersion: versionTag,
  isSynthetic: z.boolean(),
  scope: z.object({ shopIds: uniqueUuids(20) }).strict(),
  page: z.object({
    limit: z.number().int().min(1).max(100),
    returned: z.number().int().min(0).max(100),
    hasMore: z.boolean(),
    nextCursor: opaqueCursor,
  }).strict(),
  limitations: z.array(z.string().trim().min(1).max(240)).max(20),
}).strict();

function readResponseSchema<Resource extends string, Item extends z.ZodType>(resource: Resource, item: Item) {
  return responseMetadata.extend({
    resource: z.literal(resource),
    items: z.array(item).max(100),
  }).strict().superRefine((value, ctx) => {
    if (value.page.returned !== value.items.length) ctx.addIssue({ code: 'custom', path: ['page', 'returned'], message: 'Returned count must match items' });
    if (value.page.hasMore !== (value.page.nextCursor !== null)) ctx.addIssue({ code: 'custom', path: ['page', 'nextCursor'], message: 'nextCursor must be present exactly when hasMore is true' });
    const allowed = new Set(value.scope.shopIds);
    if (resource === 'products') {
      for (const [index, product] of (value.items as ProductReadItem[]).entries()) {
        if (product.listedShopIds.some(shopId => !allowed.has(shopId))) ctx.addIssue({ code: 'custom', path: ['items', index, 'listedShopIds'], message: 'Item shop is outside response scope' });
      }
    }
    if (resource === 'sales') {
      for (const [index, sale] of (value.items as SalesReadItem[]).entries()) {
        if (sale.shopId && !allowed.has(sale.shopId)) ctx.addIssue({ code: 'custom', path: ['items', index, 'shopId'], message: 'Item shop is outside response scope' });
      }
    }
    if (resource === 'inventory') {
      for (const [index, inventory] of (value.items as InventoryReadItem[]).entries()) {
        if (inventory.channels.some(channel => !allowed.has(channel.shopId))) ctx.addIssue({ code: 'custom', path: ['items', index, 'channels'], message: 'Channel is outside response scope' });
      }
    }
  });
}

export const productReadResponseSchema = readResponseSchema('products', productReadItemSchema);
export const salesReadResponseSchema = readResponseSchema('sales', salesReadItemSchema);
export const inventoryReadResponseSchema = readResponseSchema('inventory', inventoryReadItemSchema);

export const agentApiErrorCodes = [
  'INVALID_REQUEST', 'UNAUTHENTICATED', 'SIGNATURE_INVALID', 'REQUEST_EXPIRED', 'REQUEST_REPLAYED', 'SERVICE_IDENTITY_EXPIRED', 'WRONG_AUDIENCE', 'WRONG_ENVIRONMENT',
  'SCOPE_FORBIDDEN', 'SHOP_FORBIDDEN', 'RATE_LIMITED', 'SNAPSHOT_EXPIRED', 'NOT_FOUND', 'INTERNAL_ERROR',
] as const;
export type AgentApiErrorCode = typeof agentApiErrorCodes[number];
export const agentApiErrorSemantics = {
  INVALID_REQUEST: { status: 400, retryable: false },
  UNAUTHENTICATED: { status: 401, retryable: false },
  SIGNATURE_INVALID: { status: 401, retryable: false },
  REQUEST_EXPIRED: { status: 401, retryable: false },
  REQUEST_REPLAYED: { status: 409, retryable: false },
  SERVICE_IDENTITY_EXPIRED: { status: 401, retryable: false },
  WRONG_AUDIENCE: { status: 403, retryable: false },
  WRONG_ENVIRONMENT: { status: 403, retryable: false },
  SCOPE_FORBIDDEN: { status: 403, retryable: false },
  SHOP_FORBIDDEN: { status: 403, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  SNAPSHOT_EXPIRED: { status: 409, retryable: true },
  NOT_FOUND: { status: 404, retryable: false },
  INTERNAL_ERROR: { status: 500, retryable: true },
} as const satisfies Record<AgentApiErrorCode, { status: 400 | 401 | 403 | 404 | 409 | 429 | 500; retryable: boolean }>;
export const agentApiErrorSchema = z.object({
  contractVersion: z.literal(commerceAgentContractVersion),
  requestId: z.string().uuid(),
  error: z.object({
    code: z.enum(agentApiErrorCodes),
    message: z.string().trim().min(1).max(240),
    retryable: z.boolean(),
    fieldIssues: z.array(z.object({ path: z.string().max(160), message: z.string().max(240) }).strict()).max(25).default([]),
  }).strict(),
}).strict();
export type AgentApiError = z.infer<typeof agentApiErrorSchema>;

export type AgentReadOperation = 'products.query' | 'sales.query' | 'inventory.query';
export const agentApiOperations = {
  'products.query': { method: 'POST', effect: 'read', path: '/api/agent/v1/products/query', requiredScope: 'catalog:read', input: productQuerySchema, output: productReadResponseSchema },
  'sales.query': { method: 'POST', effect: 'read', path: '/api/agent/v1/sales/query', requiredScope: 'sales:read', input: salesQuerySchema, output: salesReadResponseSchema },
  'inventory.query': { method: 'POST', effect: 'read', path: '/api/agent/v1/inventory/query', requiredScope: 'inventory:read', input: inventoryQuerySchema, output: inventoryReadResponseSchema },
} as const satisfies Record<AgentReadOperation, { method: 'POST'; effect: 'read'; path: string; requiredScope: AgentReadScope; input: z.ZodType; output: z.ZodType }>;

export class AgentContractAuthorizationError extends Error {
  constructor(public readonly code: 'SCOPE_FORBIDDEN' | 'SHOP_FORBIDDEN', message: string) { super(message); }
}

/**
 * This is defence-in-depth contract authorization, not credential validation.
 * EVE-POC-04 must create the trusted context from an authenticated request.
 */
export function authorizeAgentQuery(contextInput: unknown, operation: AgentReadOperation, queryInput: unknown) {
  const context = agentRequestContextSchema.parse(contextInput);
  const definition = agentApiOperations[operation];
  const query = definition.input.parse(queryInput) as { shopIds: string[] };
  if (!context.scopes.includes(definition.requiredScope)) {
    throw new AgentContractAuthorizationError('SCOPE_FORBIDDEN', `Missing ${definition.requiredScope}`);
  }
  const delegated = new Set(context.allowedShopIds);
  if (query.shopIds.some(shopId => !delegated.has(shopId))) {
    throw new AgentContractAuthorizationError('SHOP_FORBIDDEN', 'Requested shop is outside the verified delegation');
  }
  return { context, query, definition };
}
