import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { handleApi } from "@/lib/http";
import { getResultForUser } from "@/lib/services";

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const session = await requireSession(request);
    return getResultForUser(session.userId);
  });
}
