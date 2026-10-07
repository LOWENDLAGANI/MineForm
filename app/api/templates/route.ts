import { NextResponse, type NextRequest } from "next/server";
import { handleError, rateLimit } from "@/lib/api";
import { createServiceClient } from "@/lib/supabase";
import { BUILT_IN_TEMPLATES } from "@/lib/templates";

export const dynamic = "force-dynamic";

/**
 * GET /api/templates — built-in starter templates plus community templates
 * published by any user (free marketplace). No auth required to browse.
 */
export async function GET(req: NextRequest) {
  try {
    rateLimit(req, "templates:list", 60);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("public_templates")
      .select("id, name, description, definition, author_email, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    return NextResponse.json({
      builtIn: BUILT_IN_TEMPLATES,
      community: (data ?? []).map((t) => ({
        key: `community:${t.id}`,
        name: t.name,
        description: t.description,
        author: t.author_email ? t.author_email.replace(/@.*/, "@…") : null,
        definition: t.definition,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
