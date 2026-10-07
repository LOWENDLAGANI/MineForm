import { z } from "zod";
import {
  AccessConfigSchema,
  CloseConfigSchema,
  DesignConfigSchema,
  EndingConfigSchema,
  FormSettingsSchema,
  IntegrationsSchema,
  LogicRuleSchema,
  OptionSchema,
  ScoringConfigSchema,
  ThemeConfigSchema,
  TranslationSchema,
  ValidationRulesSchema,
} from "@/lib/types";

/**
 * Shared question/form patch schemas for POST /api/forms and
 * PATCH /api/forms/[id]. Keeping them in one place stops the two routes
 * drifting apart when a new feature adds fields.
 */
export const QuestionInputSchema = z.object({
  question_text: z.string().min(1).max(5000),
  question_type: z.enum([
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
  ]),
  options: z.array(OptionSchema).default([]),
  validation_rules: ValidationRulesSchema.default({}),
  logic_rules: z.array(LogicRuleSchema).default([]),
  translations: z.record(TranslationSchema).default({}),
  shuffle_options: z.boolean().default(false),
  is_required: z.boolean().default(false),
});

export const FormFeatureFieldsSchema = z
  .object({
    time_limit_minutes: z.number().int().positive().nullable().optional(),
    response_cap: z.number().int().positive().nullable().optional(),
    renderer_mode: z.enum(["classic", "conversational"]).optional(),
    send_confirmation_email: z.boolean().optional(),
    close_config: CloseConfigSchema.optional(),
    theme_config: ThemeConfigSchema.partial().passthrough().optional(),
    settings: FormSettingsSchema.partial().optional(),
    scoring_config: ScoringConfigSchema.partial().optional(),
    ending_config: EndingConfigSchema.optional(),
    design_config: DesignConfigSchema.partial().optional(),
    integrations: IntegrationsSchema.partial().optional(),
    access_config: AccessConfigSchema.partial().optional(),
    payment_config: z.record(z.unknown()).optional(),
  })
  .strict();

export type FormFeatureFields = z.infer<typeof FormFeatureFieldsSchema>;
