/**
 * Minimal Database type stub matching the init + feature-batch migrations.
 * Generate the full version with:
 *   npx supabase gen types typescript --project-id <ref> > lib/db-types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | null } | Json[];

export type FormRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  slug: string;
  time_limit_minutes: number | null;
  response_cap: number | null;
  renderer_mode: "classic" | "conversational";
  send_confirmation_email: boolean;
  close_config: Json;
  theme_config: Json;
  payment_config: Json;
  settings: Json;
  scoring_config: Json;
  ending_config: Json;
  design_config: Json;
  integrations: Json;
  access_config: Json;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type QuestionRow = {
  id: string;
  form_id: string;
  question_text: string;
  question_type: string;
  options: Json;
  validation_rules: Json;
  logic_rules: Json;
  translations: Json;
  shuffle_options: boolean;
  is_required: boolean;
  order_index: number;
};

export type ResponseRow = {
  id: string;
  form_id: string;
  started_at: string;
  submitted_at: string | null;
  expires_at: string | null;
  recovery_token: string | null;
  recovery_token_created_at: string | null;
  score: number | null;
  ending_id: string | null;
  locale: string | null;
  respondent_meta: Json;
};

export type AnswerRow = {
  id: string;
  response_id: string;
  question_id: string;
  answer_text: string | null;
  answer_json: Json | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  response_id: string;
  provider: "stripe" | "billplz";
  provider_ref: string | null;
  amount_cents: number;
  currency: string;
  status: "pending" | "succeeded" | "failed" | "refunded";
  created_at: string;
  updated_at: string;
};

export type WebhookEventRow = {
  id: string;
  provider: "stripe" | "billplz";
  payload: Json;
  processed_at: string | null;
  created_at: string;
};

export type FormCollaboratorRow = {
  id: string;
  form_id: string;
  user_id: string | null;
  email: string;
  role: "editor" | "viewer";
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  form_id: string;
  actor: string;
  action: string;
  detail: Json;
  created_at: string;
};

export type EmailVerificationRow = {
  id: string;
  form_id: string;
  email: string;
  token_hash: string;
  verified_at: string | null;
  created_at: string;
};

export type PublicTemplateRow = {
  id: string;
  user_id: string;
  author_email: string | null;
  name: string;
  description: string;
  definition: Json;
  created_at: string;
};

/** Shape expected by supabase-js generic for `supabase.from("...")` calls. */
export interface Database {
  public: {
    Tables: {
      forms: { Row: FormRow; Insert: Partial<FormRow> & Pick<FormRow, "user_id" | "title" | "slug">; Update: Partial<FormRow> };
      questions: { Row: QuestionRow; Insert: Partial<QuestionRow> & Pick<QuestionRow, "form_id" | "question_text">; Update: Partial<QuestionRow> };
      responses: { Row: ResponseRow; Insert: Partial<ResponseRow> & Pick<ResponseRow, "form_id">; Update: Partial<ResponseRow> };
      answers: { Row: AnswerRow; Insert: Partial<AnswerRow> & Pick<AnswerRow, "response_id" | "question_id">; Update: Partial<AnswerRow> };
      payments: { Row: PaymentRow; Insert: Partial<PaymentRow> & Pick<PaymentRow, "response_id" | "provider" | "amount_cents" | "currency">; Update: Partial<PaymentRow> };
      webhook_events: { Row: WebhookEventRow; Insert: { id: string; provider: "stripe" | "billplz"; payload: Json }; Update: Partial<WebhookEventRow> };
      form_collaborators: { Row: FormCollaboratorRow; Insert: Partial<FormCollaboratorRow> & Pick<FormCollaboratorRow, "form_id" | "email" | "role">; Update: Partial<FormCollaboratorRow> };
      audit_log: { Row: AuditLogRow; Insert: Partial<AuditLogRow> & Pick<AuditLogRow, "form_id" | "actor" | "action">; Update: Partial<AuditLogRow> };
      email_verifications: { Row: EmailVerificationRow; Insert: Partial<EmailVerificationRow> & Pick<EmailVerificationRow, "form_id" | "email" | "token_hash">; Update: Partial<EmailVerificationRow> };
      public_templates: { Row: PublicTemplateRow; Insert: Partial<PublicTemplateRow> & Pick<PublicTemplateRow, "user_id" | "name" | "definition">; Update: Partial<PublicTemplateRow> };
    };
  };
}
