import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { handleApi } from "@/lib/http";
import { getAssessmentProgress } from "@/lib/services";

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const session = await requireSession(request);
    return getAssessmentProgress(session.userId);
  });
}
