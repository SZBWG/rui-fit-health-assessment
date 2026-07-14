import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handleApi, parseJson } from "@/lib/http";
import { activateMockSubscription } from "@/lib/services";

const paySchema = z
  .object({
    eventId: z.string().min(8).max(100),
    planCode: z.literal("demo_monthly").default("demo_monthly"),
  })
  .strict();

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const session = await requireSession(request);
    const body = await parseJson(request, paySchema);
    return activateMockSubscription({ userId: session.userId, ...body });
  });
}
