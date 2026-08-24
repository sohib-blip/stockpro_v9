import { z } from "zod";

const packagingIdSchema = z.string().uuid();
const packagingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,49}$/);
const dimensionSchema = z.coerce.number().positive().max(1000);
const minimumStockSchema = z.coerce.number().int().min(0).max(10_000_000);
const onHandStockSchema = z.coerce.number().int().min(0).max(10_000_000);
const operationIdSchema = z.string().uuid().optional();

export const packagingCreateSchema = z.object({
  operation_id: operationIdSchema,
  code: packagingCodeSchema,
  name: z.string().trim().min(1).max(120),
  category: z.enum(["BOX", "BUBBLE_ENVELOPE", "PLASTIC_ENVELOPE"]),
  length_cm: dimensionSchema,
  width_cm: dimensionSchema,
  height_cm: dimensionSchema,
  on_hand_stock: onHandStockSchema.default(0),
  minimum_stock: minimumStockSchema.default(0),
});

export const packagingUpdateSchema = packagingCreateSchema
  .omit({ on_hand_stock: true })
  .extend({
    id: packagingIdSchema,
    on_hand_stock: onHandStockSchema,
  });

export const packagingToggleSchema = z.object({
  id: packagingIdSchema,
  active: z.boolean(),
});

export const packagingAdjustmentSchema = z.object({
  operation_id: z.string().uuid(),
  packaging_type_id: packagingIdSchema,
  mode: z.enum(["receive", "remove", "set"]),
  quantity: z.coerce.number().int().min(0).max(10_000_000),
  reason: z.string().trim().min(1).max(500),
});

export const packagingHistoryQuerySchema = z.object({
  packaging_type_id: packagingIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
