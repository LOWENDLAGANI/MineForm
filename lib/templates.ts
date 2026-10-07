/**
 * Built-in, free starter templates. Each produces a full form definition the
 * client can POST to /api/forms. Question ids are generated at creation time.
 */

export interface TemplateQuestion {
  question_text: string;
  question_type: string;
  options?: { label: string; isExclusive?: boolean; points?: number }[];
  validation_rules?: Record<string, unknown>;
  is_required?: boolean;
}

export interface FormTemplate {
  key: string;
  name: string;
  description: string;
  icon: string;
  renderer_mode?: "classic" | "conversational";
  scoring?: boolean;
  questions: TemplateQuestion[];
}

export const BUILT_IN_TEMPLATES: FormTemplate[] = [
  {
    key: "contact",
    name: "Contact form",
    description: "Name, email and message — the everyday inbox form.",
    icon: "✉️",
    questions: [
      { question_text: "What's your name?", question_type: "short_text", is_required: true, validation_rules: { maxLength: 120 } },
      { question_text: "Your email address", question_type: "email", is_required: true },
      { question_text: "How can we help?", question_type: "long_text", is_required: true, validation_rules: { maxLength: 3000 } },
    ],
  },
  {
    key: "feedback",
    name: "Customer feedback",
    description: "Rating + open comments with a recommendation question.",
    icon: "💬",
    questions: [
      { question_text: "How satisfied are you overall?", question_type: "rating", is_required: true, validation_rules: { maxRating: 5 } },
      { question_text: "How likely are you to recommend us?", question_type: "rating", validation_rules: { maxRating: 10 } },
      { question_text: "What did we do well?", question_type: "long_text" },
      { question_text: "What could we improve?", question_type: "long_text" },
    ],
  },
  {
    key: "nps",
    name: "NPS survey",
    description: "Classic 0–10 promoter score with a follow-up.",
    icon: "📊",
    questions: [
      { question_text: "How likely are you to recommend us to a friend?", question_type: "rating", is_required: true, validation_rules: { maxRating: 10 } },
      { question_text: "What's the main reason for your score?", question_type: "long_text", validation_rules: { maxLength: 1000 } },
    ],
  },
  {
    key: "quiz",
    name: "Scored quiz",
    description: "Multiple-choice knowledge quiz with points per answer.",
    icon: "🧠",
    scoring: true,
    questions: [
      { question_text: "Which planet is closest to the sun?", question_type: "single_choice", is_required: true, options: [{ label: "Venus", points: 1 }, { label: "Mercury", points: 0 }, { label: "Mars", points: 0 }] },
      { question_text: "What does 'HTTP' stand for?", question_type: "single_choice", is_required: true, options: [{ label: "HyperText Transfer Protocol", points: 1 }, { label: "High Transfer Text Protocol", points: 0 }, { label: "Hyperlink Transit Protocol", points: 0 }] },
      { question_text: "2 + 2 × 3 = ?", question_type: "single_choice", is_required: true, options: [{ label: "8", points: 1 }, { label: "12", points: 0 }, { label: "10", points: 0 }] },
    ],
  },
  {
    key: "rsvp",
    name: "Event RSVP",
    description: "Attendance, guests and dietary needs.",
    icon: "🎉",
    questions: [
      { question_text: "Will you attend?", question_type: "single_choice", is_required: true, options: [{ label: "Yes, see you there!" }, { label: "Sorry, can't make it", isExclusive: true }] },
      { question_text: "How many guests (including you)?", question_type: "number", validation_rules: { min: 1, max: 10 } },
      { question_text: "Any dietary requirements?", question_type: "long_text" },
    ],
  },
  {
    key: "application",
    name: "Job application",
    description: "Candidate details, links and a cover letter.",
    icon: "💼",
    questions: [
      { question_text: "Full name", question_type: "short_text", is_required: true },
      { question_text: "Email", question_type: "email", is_required: true },
      { question_text: "Role you're applying for", question_type: "single_choice", is_required: true, options: [{ label: "Engineering" }, { label: "Design" }, { label: "Marketing" }, { label: "Other" }] },
      { question_text: "Portfolio or LinkedIn URL", question_type: "file_upload" },
      { question_text: "Why you?", question_type: "long_text", is_required: true, validation_rules: { maxLength: 4000 } },
    ],
  },
  {
    key: "order",
    name: "Simple order form",
    description: "Product choice with prices baked in as points-style values.",
    icon: "🛒",
    questions: [
      { question_text: "Which plan do you want?", question_type: "single_choice", is_required: true, options: [{ label: "Starter — $9" }, { label: "Pro — $29" }, { label: "Team — $79" }] },
      { question_text: "Company name", question_type: "short_text" },
      { question_text: "Billing email", question_type: "email", is_required: true },
    ],
  },
];

export function templateToFormPayload(t: FormTemplate) {
  const slug = t.key + "-" + Math.random().toString(36).slice(2, 7);
  return {
    title: t.name,
    description: t.description,
    slug,
    renderer_mode: t.renderer_mode ?? "classic",
    scoring_config: t.scoring ? { enabled: true, show_score: true } : undefined,
    questions: t.questions.map((q) => ({
      question_text: q.question_text,
      question_type: q.question_type,
      options: (q.options ?? []).map((o) => ({ id: crypto.randomUUID(), label: o.label, isExclusive: o.isExclusive, points: o.points })),
      validation_rules: q.validation_rules ?? {},
      is_required: q.is_required ?? false,
    })),
  };
}
