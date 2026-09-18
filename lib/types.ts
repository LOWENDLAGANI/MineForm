import { z } from "zod";

/* ---------------------------------------------------------------------------
 * Question types
 * ------------------------------------------------------------------------- */
export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "dropdown",
  "rating",
  "date",
  "number",
  "email",
  "file_upload",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/* ---------------------------------------------------------------------------
 * Validation rules (stored in questions.validation_rules JSONB)
 * ------------------------------------------------------------------------- */
export const ValidationRulesSchema = z
  .object({
    minLength: z.number().int().positive().optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    pattern: z.string().optional(),
    maxRating: z.number().int().min(1).max(10).optional(),
    maxFiles: z.number().int().positive().max(10).optional(),
    maxFileSizeMb: z.number().positive().optional(),
  })
  .strict();

export type ValidationRules = z.infer<typeof ValidationRulesSchema>;

/* ---------------------------------------------------------------------------
 * Conditional logic (stored in questions.logic_rules JSONB)
 *
 * A rule says: IF <conditions> THEN show/skip/require this question.
 * All conditions in one rule AND together; multiple rules OR together.
 * ------------------------------------------------------------------------- */
export const LogicConditionSchema = z
  .object({
    questionId: z.string().uuid(),
    operator: z.enum([
      "eq",
      "neq",
      "contains",
      "not_contains",
      "gt",
      "gte",
      "lt",
      "lte",
      "is_checked",
      "is_empty",
    ]),
    /** Comparison value. Null for is_checked / is_empty. */
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  })
  .strict();

export const LogicRuleSchema = z
  .object({
    action: z.enum(["show", "hide", "skip", "require"]),
    /** All conditions AND together; rules OR together. */
    conditions: z.array(LogicConditionSchema).min(1),
  })
  .strict();

export type LogicRule = z.infer<typeof LogicRuleSchema>;
export type LogicCondition = z.infer<typeof LogicConditionSchema>;

/* ---------------------------------------------------------------------------
 * Options (stored in questions.options JSONB)
 * ------------------------------------------------------------------------- */
export const OptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** Marks the choice that terminates the form (e.g. "None of the above"). */
    isExclusive: z.boolean().optional(),
  })
  .strict();

export type Option = z.infer<typeof OptionSchema>;

/* ---------------------------------------------------------------------------
 * Question + Form
 * ------------------------------------------------------------------------- */
export const QuestionSchema = z
  .object({
    id: z.string().uuid(),
    form_id: z.string().uuid(),
    question_text: z.string().min(1).max(5000),
    question_type: z.enum(QUESTION_TYPES),
    options: z.array(OptionSchema).default([]),
    validation_rules: ValidationRulesSchema.default({}),
    logic_rules: z.array(LogicRuleSchema).default([]),
    is_required: z.boolean().default(false),
    order_index: z.number().int().min(0),
  })
  .strict();

export type Question = z.infer<typeof QuestionSchema>;

export const ThemeConfigSchema = z
  .object({
    accent: z.string().default("#000000"),
    surface: z.string().default("#ffffff"),
    text: z.string().default("#09090b"),
    font: z.enum(["inter", "geist", "system"]).default("inter"),
    width: z.enum(["compact", "regular", "wide"]).default("regular"),
  })
  .strict();

export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

/* ---------------------------------------------------------------------------
 * Close conditions (stored in forms.close_config JSONB)
 * ------------------------------------------------------------------------- */
export const CloseConditionSchema = z
  .object({
    question_id: z.string().uuid(),
    operator: z.enum(["eq", "contains"]),
    value: z.string().min(1).max(500),
    /** Close once this many matching responses exist (default 1). */
    count: z.number().int().min(1).optional(),
  })
  .strict();

export type CloseCondition = z.infer<typeof CloseConditionSchema>;

export const CloseConfigSchema = z
  .object({
    /** ISO timestamp — the form closes automatically after this moment. */
    close_at: z.string().nullable().optional(),
    /** OR-combined: any condition met closes the form. */
    conditions: z.array(CloseConditionSchema).default([]),
  })
  .strict();

export type CloseConfig = z.infer<typeof CloseConfigSchema>;

export const FormSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    title: z.string().min(1).max(300),
    description: z.string().nullable(),
    slug: z.string().min(1),
    time_limit_minutes: z.number().int().positive().nullable(),
    response_cap: z.number().int().positive().nullable(),
    renderer_mode: z.enum(["classic", "conversational"]).default("classic"),
    send_confirmation_email: z.boolean().default(false),
    close_config: CloseConfigSchema.default({ conditions: [] }),
    theme_config: ThemeConfigSchema,
    payment_config: z.record(z.unknown()).default({}).optional(),
    is_published: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export type Form = z.infer<typeof FormSchema>;

/* ---------------------------------------------------------------------------
 * Submission payload (client -> POST /api/public/forms/[slug]/submit)
 * ------------------------------------------------------------------------- */
export const AnswerPayloadSchema = z
  .object({
    questionId: z.string().uuid(),
    text: z.string().max(10000).nullable().optional(),
    json: z.unknown().nullable().optional(),
  })
  .refine((a) => a.text != null || a.json != null, {
    message: "answer must set either text or json",
  });

export const SubmitPayloadSchema = z
  .object({
    responseId: z.string().uuid(),
    answers: z.array(AnswerPayloadSchema).min(1),
  })
  .strict();

export type SubmitPayload = z.infer<typeof SubmitPayloadSchema>;
export type AnswerPayload = z.infer<typeof AnswerPayloadSchema>;

/* ---------------------------------------------------------------------------
 * API error envelope — every route responds with this shape on failure
 * ------------------------------------------------------------------------- */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "FORM_NOT_PUBLISHED"
  | "FORM_CLOSED"
  | "RESPONSE_CAP_REACHED"
  | "RESPONSE_EXPIRED"
  | "PAYMENT_REQUIRED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "DRAFT_NOT_FOUND"
  | "INTERNAL";

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

export class ApiErrorFactory extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiError(code: ApiErrorCode, message: string, status = 400): ApiErrorFactory {
  return new ApiErrorFactory(code, message, status);
}
