import { z } from "zod";

const packagingIdSchema = z.string().uuid();
const packagingCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,49}$/);
const dimensionSchema = z.coerce.number().positive().max(1000).nullable().optional();
const minimumStockSchema = z.coerce.number().int().min(0).max(10_000_000);
const onHandStockSchema = z.coerce.number().int().min(0).max(10_000_000);
const operationIdSchema = z.string().uuid().optional();

const packagingDetailsSchema = z.object({
  operation_id: operationIdSchema,
  code: packagingCodeSchema,
  name: z.string().trim().min(1).max(120),
  category: z.enum(["BOX", "BUBBLE_ENVELOPE", "PLASTIC_ENVELOPE", "SLEEVE"]),
  length_cm: dimensionSchema,
  width_cm: dimensionSchema,
  height_cm: dimensionSchema,
  on_hand_stock: onHandStockSchema.default(0),
  minimum_stock: minimumStockSchema.default(0),
});

// Sleeves have no dimensions; every other format needs all three.
function addDimensionIssue(
  value: {
    category: string;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
  },
  context: z.RefinementCtx
) {
  const dimensions = [value.length_cm, value.width_cm, value.height_cm];
  const sleeve = value.category === "SLEEVE";
  const valid = sleeve
    ? dimensions.every((dimension) => dimension === null || dimension === undefined)
    : dimensions.every((dimension) => typeof dimension === "number");
  if (!valid) {
    context.addIssue({
      code: "custom",
      message: sleeve ? "Sleeves have no dimensions" : "Length, width and height are required",
    });
  }
}

export const packagingCreateSchema = packagingDetailsSchema.superRefine(addDimensionIssue);

export const packagingUpdateSchema = packagingDetailsSchema
  .omit({ on_hand_stock: true })
  .extend({
    id: packagingIdSchema,
    on_hand_stock: onHandStockSchema,
  })
  .superRefine(addDimensionIssue);

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
