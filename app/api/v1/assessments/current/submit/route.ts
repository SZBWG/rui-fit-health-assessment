import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { handleApi } from "@/lib/http";
import { submitAssessment } from "@/lib/services";

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const session = await requireSession(request);
    return submitAssessment(session.userId);
  });
}
