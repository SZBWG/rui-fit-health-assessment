import type { NextRequest } from "next/server";
import { saveStepBodySchema, stepKeySchema } from "@/lib/assessment";
import { requireSession } from "@/lib/auth";
import { handleApi, parseJson } from "@/lib/http";
import { saveAssessmentStep } from "@/lib/services";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ stepKey: string }> },
) {
  return handleApi(async () => {
    const session = await requireSession(request);
    const { stepKey } = await context.params;
    const step = stepKeySchema.parse(stepKey);
    const body = await parseJson(request, saveStepBodySchema);
    return saveAssessmentStep({
      userId: session.userId,
      step,
      data: body.data,
      baseRevision: body.baseRevision,
      idempotencyKey: request.headers.get("idempotency-key") ?? "",
    });
  });
}
