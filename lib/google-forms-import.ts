/**
 * Best-effort Google Forms import. Fetches a public "Anyone with the link"
 * viewform URL, parses the embedded FB_PUBLIC_LOAD_DATA_ blob and maps the
 * common question types. Google can change this format at any time, so every
 * failure degrades into a clear, non-crashing error message.
 */

export interface ImportedQuestion {
  question_text: string;
  question_type: string;
  options: { id: string; label: string }[];
  is_required: boolean;
  validation_rules: Record<string, unknown>;
}

export interface ImportedForm {
  title: string;
  description: string;
  questions: ImportedQuestion[];
  warnings: string[];
}

function extractJson(html: string): unknown {
  const marker = "FB_PUBLIC_LOAD_DATA_";
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error("This form doesn't look publicly shareable. Set 'Anyone with the link' and try again.");
  const start = html.indexOf("=", idx) + 1;
  const end = html.indexOf(";</script>", start);
  const raw = html.slice(start, end === -1 ? undefined : end).trim().replace(/;$/, "");
  return JSON.parse(raw);
}

/** Google item types → MineForm types (everything else falls back to text). */
function mapType(gtype: number): { type: string; rules: Record<string, unknown> } {
  switch (gtype) {
    case 0: return { type: "short_text", rules: {} };
    case 1: return { type: "long_text", rules: {} };
    case 2: return { type: "single_choice", rules: {} };
    case 3: return { type: "dropdown", rules: {} };
    case 4: return { type: "multi_choice", rules: {} };
    case 5: return { type: "rating", rules: { maxRating: 10 } };
    case 7: return { type: "single_choice", rules: {} }; // grid → one choice row
    case 9: return { type: "date", rules: {} };
    case 8: return { type: "single_choice", rules: {} }; // scale
    default: return { type: "short_text", rules: {} };
  }
}

export async function importGoogleForm(formUrl: string): Promise<ImportedForm> {
  const url = new URL(formUrl);
  if (!/docs\.google\.com\/forms/.test(url.host + url.pathname)) {
    throw new Error("That's not a Google Forms link.");
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/viewform")) url.pathname = url.pathname.replace(/\/(edit|formResponse).*$/, "/viewform");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let html: string;
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MineForm/1.0)" },
    });
    if (!res.ok) throw new Error(`Google returned ${res.status} — check the link is public.`);
    html = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("Google took too long to respond.");
    throw err instanceof Error ? err : new Error("Could not fetch that form.");
  } finally {
    clearTimeout(timer);
  }

  const data = extractJson(html) as unknown[];
  const formMeta = Array.isArray(data) ? data : [];
  const title = typeof formMeta[3] === "string" && formMeta[3] ? formMeta[3] : "Imported form";
  const description = typeof formMeta[0] === "string" ? formMeta[0] : "";

  const warnings: string[] = [];
  const questions: ImportedQuestion[] = [];
  const items = (formMeta[1] as unknown[] | undefined) ?? [];

  let position = 0;
  for (const item of items) {
    if (!Array.isArray(item)) continue;
    // item layout: [title, description, type(?), entryId..., questionFields]
    const qTitle = typeof item[0] === "string" ? item[0].trim() : "";
    const fields = item[4] as unknown[] | undefined;
    if (!qTitle || !Array.isArray(fields) || fields.length === 0) continue;

    // Section headers have no input fields (type 8 entries etc.)
    const first = Array.isArray(fields[0]) ? (fields[0] as unknown[]) : [];
    const gtype = typeof first[3] === "number" ? (first[3] as number) : null;
    if (gtype === null) continue;
    position += 1;

    let mappedType = mapType(gtype).type;
    const rules = mapType(gtype).rules;
    if ([0, 1, 2, 3, 4, 5, 9].indexOf(gtype) === -1) {
      warnings.push(`"${qTitle.slice(0, 40)}" used an unsupported Google question type — imported as text.`);
    }

    let type = mappedType;
    let options: { id: string; label: string }[] = [];
    if (type === "single_choice" || type === "multi_choice" || type === "dropdown") {
      const rawChoices = (first[1] as unknown[] | undefined) ?? [];
      options = rawChoices
        .map((c) => (Array.isArray(c) && typeof c[0] === "string" ? c[0] : null))
        .filter((l): l is string => l !== null && l.length > 0)
        .map((label) => ({ id: crypto.randomUUID(), label }));
      if (options.length === 0) {
        type = typeFallback(type);
        warnings.push(`"${qTitle.slice(0, 40)}" had no visible options — imported as text.`);
      }
    }
    if (gtype === 5 && Array.isArray(first) && typeof first[2] === "object" && first[2] !== null) {
      // linear scale: [?, low, {…low:0, high:10}]
      const scale = first[2] as { low?: number; high?: number };
      if (typeof scale.high === "number") rules.maxRating = Math.min(10, Math.max(1, scale.high - (scale.low ?? 0)));
    }

    questions.push({
      question_text: qTitle.slice(0, 5000),
      question_type: type,
      options,
      is_required: fields.some((f) => Array.isArray(f) && (f[2] as unknown[] | undefined)?.[4] === 1),
      validation_rules: rules,
    });
  }

  if (questions.length === 0) {
    throw new Error("No questions could be parsed from that form. It may be private or use unsupported features.");
  }

  return { title, description, questions, warnings };
}

function typeFallback(t: string): string {
  return t === "dropdown" || t === "multi_choice" || t === "single_choice" ? "short_text" : t;
}
