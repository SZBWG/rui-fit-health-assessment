import {
  assessmentProgress,
  calculateHealthAssessment,
  inputFromAssessment,
  parseStepData,
  requestHash,
  type AssessmentRecord,
  type StepKey,
} from "@/lib/assessment";
import { ApiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

function errorCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if ("code" in current) return String(current.code);
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

async function retryProtocolConflict<T>(query: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await query();
    } catch (error) {
      if (errorCode(error) !== "08P01" || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error("Unreachable retry state");
}

async function currentAssessment(userId: string) {
  const assessment = await retryProtocolConflict(() => getPrisma().assessment.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  }));
  if (!assessment) throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found");
  return assessment;
}

export async function getAssessmentProgress(userId: string) {
  return assessmentProgress(await currentAssessment(userId));
}

export async function saveAssessmentStep(input: {
  userId: string;
  step: StepKey;
  data: unknown;
  baseRevision: number;
  idempotencyKey: string;
}) {
  if (!input.idempotencyKey || input.idempotencyKey.length > 100) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required");
  }

  const prisma = getPrisma();
  const updateData = parseStepData(input.step, input.data);
  const hash = requestHash({ step: input.step, data: updateData, baseRevision: input.baseRevision });
  const assessment = await currentAssessment(input.userId);
  const prior = await retryProtocolConflict(() => prisma.assessmentUpdate.findUnique({
    where: { assessmentId_idempotencyKey: { assessmentId: assessment.id, idempotencyKey: input.idempotencyKey } },
  }));
  if (prior) {
    if (prior.requestHash !== hash) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used with different data");
    }
    return prior.response;
  }

  if (assessment.status !== "IN_PROGRESS") {
    throw new ApiError(409, "ASSESSMENT_LOCKED", "Completed assessments cannot be edited");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.assessment.updateMany({
        where: {
          id: assessment.id,
          userId: input.userId,
          status: "IN_PROGRESS",
          revision: input.baseRevision,
        },
        data: {
          ...updateData,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        const latest = await tx.assessment.findUniqueOrThrow({ where: { id: assessment.id } });
        throw new ApiError(409, "REVISION_CONFLICT", "Assessment was updated by another request", {
          currentRevision: latest.revision,
        });
      }

      const latest = await tx.assessment.findUniqueOrThrow({ where: { id: assessment.id } });
      const response = assessmentProgress(latest);
      await tx.assessmentUpdate.create({
        data: {
          assessmentId: assessment.id,
          idempotencyKey: input.idempotencyKey,
          stepKey: input.step,
          requestHash: hash,
          response,
        },
      });
      return response;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (errorCode(error) === "P2002") {
      const duplicate = await prisma.assessmentUpdate.findUnique({
        where: { assessmentId_idempotencyKey: { assessmentId: assessment.id, idempotencyKey: input.idempotencyKey } },
      });
      if (duplicate?.requestHash === hash) return duplicate.response;
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used");
    }
    if (errorCode(error) === "P2034") {
      const latest = await currentAssessment(input.userId);
      throw new ApiError(409, "REVISION_CONFLICT", "Assessment was updated by another request", {
        currentRevision: latest.revision,
      });
    }
    const latest = await currentAssessment(input.userId);
    if (latest.revision !== input.baseRevision) {
      throw new ApiError(409, "REVISION_CONFLICT", "Assessment was updated by another request", {
        currentRevision: latest.revision,
      });
    }
    throw error;
  }
}

export async function submitAssessment(userId: string, now = new Date()) {
  const prisma = getPrisma();
  const assessment = await currentAssessment(userId);
  const existing = await prisma.assessmentResult.findUnique({ where: { assessmentId: assessment.id } });
  if (existing) {
    return {
      assessmentId: assessment.id,
      status: "COMPLETED",
      calculatedAt: existing.calculatedAt.toISOString(),
    };
  }

  const validated = inputFromAssessment(assessment as AssessmentRecord);
  const calculated = calculateHealthAssessment(validated, now);

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.assessment.updateMany({
        where: { id: assessment.id, userId, status: "IN_PROGRESS", revision: assessment.revision },
        data: { status: "COMPLETED", submittedAt: now },
      });
      if (locked.count !== 1) throw new ApiError(409, "SUBMIT_CONFLICT", "Assessment changed while being submitted");

      const result = await tx.assessmentResult.create({
        data: {
          assessmentId: assessment.id,
          bmi: calculated.bmi,
          bmiCategory: calculated.bmiCategory,
          estimatedBmr: calculated.estimatedBmr,
          estimatedDailyCalories: calculated.estimatedDailyCalories,
          targetDate: calculated.targetDate,
          projection: calculated.projection,
          algorithmVersion: calculated.algorithmVersion,
          sourceRevision: assessment.revision,
          calculatedAt: now,
        },
      });
      return {
        assessmentId: assessment.id,
        status: "COMPLETED",
        calculatedAt: result.calculatedAt.toISOString(),
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof ApiError && error.code !== "SUBMIT_CONFLICT") throw error;
    const winner = await prisma.assessmentResult.findUnique({ where: { assessmentId: assessment.id } });
    if (winner) {
      return {
        assessmentId: assessment.id,
        status: "COMPLETED",
        calculatedAt: winner.calculatedAt.toISOString(),
      };
    }
    throw error;
  }
}

export async function getResultForUser(userId: string, now = new Date()) {
  const prisma = getPrisma();
  const result = await prisma.assessmentResult.findFirst({
    where: { assessment: { userId } },
    orderBy: { calculatedAt: "desc" },
  });
  if (!result) throw new ApiError(409, "RESULT_NOT_READY", "Complete the assessment before viewing results");

  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  const isActive = subscription?.status === "ACTIVE" && (!subscription.expiresAt || subscription.expiresAt > now);
  const subscriptionStatus = isActive
    ? "ACTIVE"
    : subscription?.status === "ACTIVE" && subscription.expiresAt && subscription.expiresAt <= now
      ? "EXPIRED"
      : subscription?.status ?? "INACTIVE";

  if (!isActive) {
    return {
      access: "PREVIEW" as const,
      subscriptionStatus,
      preview: {
        bmi: result.bmi,
        bmiCategory: result.bmiCategory,
      },
      lockedFields: ["estimatedBmr", "estimatedDailyCalories", "targetDate", "projection"],
      upgradeRequired: true,
    };
  }

  return {
    access: "FULL" as const,
    subscriptionStatus,
    result: {
      bmi: result.bmi,
      bmiCategory: result.bmiCategory,
      estimatedBmr: result.estimatedBmr,
      estimatedDailyCalories: result.estimatedDailyCalories,
      targetDate: result.targetDate.toISOString().slice(0, 10),
      projection: result.projection,
      algorithmVersion: result.algorithmVersion,
      calculatedAt: result.calculatedAt.toISOString(),
    },
    upgradeRequired: false,
  };
}

export async function activateMockSubscription(input: {
  userId: string;
  eventId: string;
  planCode: string;
  now?: Date;
}) {
  if (process.env.MOCK_PAY_ENABLED !== "true") {
    throw new ApiError(404, "MOCK_PAY_DISABLED", "Mock payment is disabled");
  }

  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const existingEvent = await prisma.paymentEvent.findUnique({ where: { providerEventId: input.eventId } });
  if (existingEvent) {
    if (existingEvent.userId !== input.userId) {
      throw new ApiError(409, "PAYMENT_EVENT_REUSED", "Payment event belongs to another session");
    }
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: existingEvent.subscriptionId } });
    return {
      eventId: input.eventId,
      subscriptionStatus: subscription.status,
      expiresAt: subscription.expiresAt?.toISOString() ?? null,
      replayed: true,
    };
  }

  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 30);

  try {
    return await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          status: "ACTIVE",
          planCode: input.planCode,
          activatedAt: now,
          expiresAt,
        },
        update: {
          status: "ACTIVE",
          planCode: input.planCode,
          activatedAt: now,
          expiresAt,
        },
      });
      await tx.paymentEvent.create({
        data: {
          providerEventId: input.eventId,
          userId: input.userId,
          subscriptionId: subscription.id,
          status: "SUCCEEDED",
          rawPayload: { eventId: input.eventId, planCode: input.planCode },
        },
      });
      return {
        eventId: input.eventId,
        subscriptionStatus: subscription.status,
        expiresAt: subscription.expiresAt?.toISOString() ?? null,
        replayed: false,
      };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (errorCode(error) === "P2002") {
      const event = await prisma.paymentEvent.findUniqueOrThrow({ where: { providerEventId: input.eventId } });
      if (event.userId !== input.userId) throw new ApiError(409, "PAYMENT_EVENT_REUSED", "Payment event belongs to another session");
      const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: event.subscriptionId } });
      return {
        eventId: input.eventId,
        subscriptionStatus: subscription.status,
        expiresAt: subscription.expiresAt?.toISOString() ?? null,
        replayed: true,
      };
    }
    throw error;
  }
}
