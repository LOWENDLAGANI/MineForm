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
    pattern: z
      .string()
      .max(500)
      .optional()
      .refine((p) => {
        if (p === undefined) return true;
        try { new RegExp(p); return true; } catch { return false; }
      }, { message: "Invalid regular expression" }),
    maxRating: z.number().int().min(1).max(10).optional(),
    maxFiles: z.number().int().positive().max(10).optional(),
    maxFileSizeMb: z.number().positive().optional(),
  })
  .strict();

export type ValidationRules = z.infer<typeof ValidationRulesSchema>;

/* ---------------------------------------------------------------------------
 * Conditional logic (stored in questions.logic_rules JSONB)
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
    /** Quiz score awarded when this option is picked (scoring mode). */
    points: z.number().optional(),
  })
  .strict();

export type Option = z.infer<typeof OptionSchema>;

/** Per-locale override for a question (i18n): { [locale]: { text, options } } */
export const TranslationSchema = z
  .object({
    text: z.string().min(1).max(5000).optional(),
    /** Option id -> translated label. */
    options: z.record(z.string(), z.string().max(500)).optional(),
  })
  .strict();

export type Translation = z.infer<typeof TranslationSchema>;

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
    /** Per-locale translated text/option labels. */
    translations: z.record(TranslationSchema).default({}),
    /** Randomize this question's option order per respondent. */
    shuffle_options: z.boolean().default(false),
  })
  .strict();

export type Question = z.infer<typeof QuestionSchema>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const ThemeConfigSchema = z
  .object({
    accent: z.string().regex(HEX_COLOR, "Accent must be a hex color like #2563eb").default("#2563eb"),
    surface: z.string().regex(HEX_COLOR, "Surface must be a hex color").default("#ffffff"),
    text: z.string().regex(HEX_COLOR, "Text must be a hex color").default("#09090b"),
    font: z.enum(["inter", "geist", "system"]).default("inter"),
    width: z.enum(["compact", "regular", "wide"]).default("regular"),
  })
  .strict();

export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

/* ---------------------------------------------------------------------------
 * Form settings (stored in forms.settings JSONB)
 * ------------------------------------------------------------------------- */
export const FormSettingsSchema = z
  .object({
    /** Shuffle visible question order per respondent. */
    shuffle_questions: z.boolean().default(false),
    /** Show the answered/total progress bar. */
    progress_bar: z.boolean().default(true),
    /** Hidden URL params captured with each response (UTM etc). */
    hidden_fields: z.array(z.string().min(1).max(60).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).max(20).default([]),
    /** One response per verified email. */
    unique_email: z.boolean().default(false),
    /** Allow browser autofill hints on name/email fields. */
    autocomplete: z.boolean().default(true),
    /** Answer locales offered to respondents (first = default). */
    locales: z.array(z.string().min(2).max(8)).max(10).default([]),
  })
  .strict();

export type FormSettings = z.infer<typeof FormSettingsSchema>;

/* ---------------------------------------------------------------------------
 * Scoring / quiz mode (stored in forms.scoring_config JSONB)
 * ------------------------------------------------------------------------- */
export const ScoringConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Show the computed score on the ending screen. */
    show_score: z.boolean().default(true),
  })
  .strict();

export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

/* ---------------------------------------------------------------------------
 * Custom ending screens (stored in forms.ending_config JSONB)
 * ------------------------------------------------------------------------- */
export const EndingConditionSchema = z
  .object({
    question_id: z.string().uuid(),
    operator: z.enum(["eq", "contains"]),
    value: z.string().min(1).max(500),
  })
  .strict();

export const EndingSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    /** First ending whose conditions all match wins. */
    conditions: z.array(EndingConditionSchema).max(10).default([]),
    message: z.string().min(1).max(2000),
  })
  .strict();

export const EndingConfigSchema = z
  .object({
    default_message: z.string().max(2000).default("Thanks for your response!"),
    endings: z.array(EndingSchema).max(20).default([]),
  })
  .strict();

export type EndingConfig = z.infer<typeof EndingConfigSchema>;
export type Ending = z.infer<typeof EndingSchema>;

/* ---------------------------------------------------------------------------
 * Design (stored in forms.design_config JSONB)
 * ------------------------------------------------------------------------- */
export const FONTS = [
  "inter",
  "system",
  "poppins",
  "playfair",
  "lora",
  "space-grotesk",
  "roboto-mono",
  "source-sans",
  "dm-sans",
  "caveat",
] as const;

export const DesignConfigSchema = z
  .object({
    /** Logo shown at the top of the public form. */
    logo_url: z.string().url().max(1000).nullable().default(null),
    /** Background image behind the form card. */
    background_url: z.string().url().max(1000).nullable().default(null),
    /** 0–90: dark overlay opacity over the background image. */
    overlay_opacity: z.number().int().min(0).max(90).default(40),
    /** Dark mode for respondents: auto follows their device. */
    dark_mode: z.enum(["off", "on", "auto"]).default("off"),
    heading_font: z.enum(FONTS).default("inter"),
    body_font: z.enum(FONTS).default("inter"),
  })
  .strict();

export type DesignConfig = z.infer<typeof DesignConfigSchema>;

/* ---------------------------------------------------------------------------
 * Integrations (stored in forms.integrations JSONB)
 * ------------------------------------------------------------------------- */
export const IntegrationsSchema = z
  .object({
    /** Email the form owner on every new response. */
    notify_email: z.boolean().default(false),
    /** Generic outgoing webhook — POSTs the sealed response JSON. */
    webhook_url: z.string().url().max(1000).nullable().default(null),
    /** Slack/Discord incoming webhook — posts a one-line summary. */
    slack_webhook_url: z.string().url().max(1000).nullable().default(null),
    /** Google Sheets sync via an Apps Script webhook (free, no OAuth). */
    sheet_webhook_url: z.string().url().max(1000).nullable().default(null),
    /** Weekly email digest of the last 7 days of responses. */
    weekly_report: z.boolean().default(false),
  })
  .strict();

export type Integrations = z.infer<typeof IntegrationsSchema>;

/* ---------------------------------------------------------------------------
 * Access control (stored in forms.access_config JSONB)
 * ------------------------------------------------------------------------- */
export const AccessConfigSchema = z
  .object({
    /** SHA-256 hex of the form password (empty = no password). */
    password_hash: z.string().max(64).nullable().default(null),
    /** The public link stops working after this ISO timestamp. */
    link_expires_at: z.string().nullable().default(null),
    /** ISO-3166 alpha-2 country allowlist (empty = every country). */
    allowed_countries: z.array(z.string().length(2)).max(100).default([]),
    /** Device allowlist (empty = all devices). */
    allowed_devices: z.array(z.enum(["mobile", "desktop"])).max(2).default([]),
  })
  .strict();

export type AccessConfig = z.infer<typeof AccessConfigSchema>;

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
    settings: FormSettingsSchema.default({}),
    scoring_config: ScoringConfigSchema.default({}),
    ending_config: EndingConfigSchema.default({}),
    design_config: DesignConfigSchema.default({}),
    integrations: IntegrationsSchema.default({}),
    access_config: AccessConfigSchema.default({}),
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
    answers: z.array(AnswerPayloadSchema).min(1).max(500),
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
  | "FORBIDDEN_COUNTRY"
  | "FORBIDDEN_DEVICE"
  | "PASSWORD_REQUIRED"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "DUPLICATE_EMAIL"
  | "LINK_EXPIRED"
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
