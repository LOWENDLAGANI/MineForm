import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleError, parseBody, rateLimit } from "@/lib/api";
import { apiError } from "@/lib/types";
import { importGoogleForm } from "@/lib/google-forms-import";

export const dynamic = "force-dynamic";

const ImportSchema = z.object({
  url: z.string().url().max(2000),
});

/**
 * POST /api/import/google-forms — paste a public Google Forms link, get back
 * a title + questions ready to review and create. Best-effort parser.
 */
export async function POST(req: NextRequest) {
  try {
    rateLimit(req, "import:gforms", 10);
    const body = await parseBody(req, ImportSchema);
    try {
      const imported = await importGoogleForm(body.url);
      return NextResponse.json(imported);
    } catch (err) {
      throw apiError(
        "VALIDATION_ERROR",
        err instanceof Error ? err.message : "Could not import that form",
        422,
      );
    }
  } catch (err) {
    return handleError(err);
  }
}
