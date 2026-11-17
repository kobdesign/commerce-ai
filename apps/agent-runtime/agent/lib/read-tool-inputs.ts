import { z } from 'zod';

export const productToolInputSchema=z.object({
  search:z.string().trim().max(100).default(''),category:z.string().trim().max(80).optional(),
  status:z.enum(['active','archived','all']).default('active'),variantIds:z.array(z.string().uuid()).max(20).optional(),
  limit:z.number().int().min(1).max(25).default(20),
}).strict();
export const salesToolInputSchema=z.object({
  period:z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict(),
  variantIds:z.array(z.string().uuid()).max(20).optional(),granularity:z.enum(['variant','variant_channel','variant_day']).default('variant'),
  orderStates:z.array(z.enum(['open','completed','cancelled'])).min(1).max(3).default(['completed']),limit:z.number().int().min(1).max(25).default(20),
}).strict();
export const inventoryToolInputSchema=z.object({
  search:z.string().trim().max(100).default(''),variantIds:z.array(z.string().uuid()).max(20).optional(),
  availability:z.enum(['all','available','low','out','reserved']).default('all'),includeChannelAllocation:z.boolean().default(true),
  limit:z.number().int().min(1).max(25).default(20),
}).strict();
