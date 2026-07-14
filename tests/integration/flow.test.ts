import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createAnonymousSession, hashSessionToken, readSessionToken, requireSession } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import {
  activateMockSubscription,
  getAssessmentProgress,
  getResultForUser,
  saveAssessmentStep,
  submitAssessment,
} from "@/lib/services";
import type { StepKey } from "@/lib/assessment";

const steps: Array<[StepKey, unknown]> = [
  ["age", { age: 32 }],
  ["gender", { gender: "FEMALE" }],
  ["goal", { goal: "LOSE_WEIGHT" }],
  ["height", { heightCm: 168 }],
  ["weight", { weightKg: 70 }],
  ["target-weight", { targetWeightKg: 62 }],
  ["activity", { activityLevel: "MODERATE" }],
];

async function fillAssessment(userId: string) {
  let revision = 0;
  for (const [index, [step, data]] of steps.entries()) {
    const progress = await saveAssessmentStep({
      userId,
      step,
      data,
      baseRevision: revision,
      idempotencyKey: `complete-${userId}-${index}`,
    });
    revision = Number((progress as { revision: number }).revision);
  }
}

async function completeAssessment(userId: string) {
  await fillAssessment(userId);
  await submitAssessment(userId, new Date("2026-01-01T00:00:00Z"));
}

function hasKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((child) => hasKey(child, key));
}

beforeEach(async () => {
  await getPrisma().user.deleteMany();
});

describe("session and progress persistence", () => {
  it("reads bearer and cookie credentials and rejects missing or expired sessions", async () => {
    const created = await createAnonymousSession();
    const bearer = new NextRequest("http://localhost/test", {
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(readSessionToken(bearer)).toBe(created.accessToken);
    expect((await requireSession(bearer)).userId).toBe(created.userId);

    const cookie = new NextRequest("http://localhost/test", {
      headers: { cookie: `health_session=${created.accessToken}` },
    });
    expect(readSessionToken(cookie)).toBe(created.accessToken);
    await expect(requireSession(new NextRequest("http://localhost/test"))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    await getPrisma().authSession.update({
      where: { id: created.sessionId },
      data: { expiresAt: new Date("2020-01-01T00:00:00Z") },
    });
    await expect(requireSession(cookie)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("stores only a token hash and restores an interrupted assessment", async () => {
    const created = await createAnonymousSession();
    const stored = await getPrisma().authSession.findUniqueOrThrow({ where: { id: created.sessionId } });
    expect(stored.tokenHash).toBe(hashSessionToken(created.accessToken));
    expect(stored.tokenHash).not.toContain(created.accessToken);

    const saved = await saveAssessmentStep({
      userId: created.userId,
      step: "age",
      data: { age: 32 },
      baseRevision: 0,
      idempotencyKey: "restore-age",
    });
    expect((saved as { nextStep: string }).nextStep).toBe("gender");

    const restored = await getAssessmentProgress(created.userId);
    expect(restored.answers.age).toBe(32);
    expect(restored.progressPercent).toBe(14);
  });

  it("accepts out-of-order steps and returns the first missing step", async () => {
    const created = await createAnonymousSession();
    const progress = await saveAssessmentStep({
      userId: created.userId,
      step: "goal",
      data: { goal: "LOSE_WEIGHT" },
      baseRevision: 0,
      idempotencyKey: "out-of-order-goal",
    });
    expect((progress as { completedSteps: string[] }).completedSteps).toEqual(["goal"]);
    expect((progress as { nextStep: string }).nextStep).toBe("age");
  });

  it("replays identical idempotent writes and rejects key reuse", async () => {
    const created = await createAnonymousSession();
    const request = {
      userId: created.userId,
      step: "age" as const,
      data: { age: 32 },
      baseRevision: 0,
      idempotencyKey: "same-request",
    };
    const first = await saveAssessmentStep(request);
    const replay = await saveAssessmentStep(request);
    expect(replay).toEqual(first);
    expect((replay as { revision: number }).revision).toBe(1);

    await expect(saveAssessmentStep({ ...request, data: { age: 33 } })).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("rejects missing idempotency keys, stale revisions, and edits after submit", async () => {
    const created = await createAnonymousSession();
    await expect(saveAssessmentStep({
      userId: created.userId,
      step: "age",
      data: { age: 32 },
      baseRevision: 0,
      idempotencyKey: "",
    })).rejects.toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });

    await saveAssessmentStep({ userId: created.userId, step: "age", data: { age: 32 }, baseRevision: 0, idempotencyKey: "stale-first" });
    await expect(saveAssessmentStep({ userId: created.userId, step: "gender", data: { gender: "FEMALE" }, baseRevision: 0, idempotencyKey: "stale-second" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });

    await getPrisma().assessment.update({ where: { id: created.assessmentId }, data: { status: "COMPLETED" } });
    await expect(saveAssessmentStep({ userId: created.userId, step: "gender", data: { gender: "FEMALE" }, baseRevision: 1, idempotencyKey: "locked-edit" })).rejects.toMatchObject({ code: "ASSESSMENT_LOCKED" });
  });

  it("rejects unknown assessments and oversized idempotency keys", async () => {
    await expect(getAssessmentProgress("00000000-0000-4000-8000-000000000099")).rejects.toMatchObject({
      code: "ASSESSMENT_NOT_FOUND",
    });

    const created = await createAnonymousSession();
    await expect(saveAssessmentStep({
      userId: created.userId,
      step: "age",
      data: { age: 32 },
      baseRevision: 0,
      idempotencyKey: "x".repeat(101),
    })).rejects.toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
  });

  it("detects concurrent writes without silently losing data", async () => {
    const created = await createAnonymousSession();
    const results = await Promise.allSettled([
      saveAssessmentStep({ userId: created.userId, step: "age", data: { age: 32 }, baseRevision: 0, idempotencyKey: "race-age" }),
      saveAssessmentStep({ userId: created.userId, step: "gender", data: { gender: "FEMALE" }, baseRevision: 0, idempotencyKey: "race-gender" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);

    let latest = await getAssessmentProgress(created.userId);
    if (latest.answers.age === null) {
      await saveAssessmentStep({ userId: created.userId, step: "age", data: { age: 32 }, baseRevision: latest.revision, idempotencyKey: "race-age-retry" });
    } else {
      await saveAssessmentStep({ userId: created.userId, step: "gender", data: { gender: "FEMALE" }, baseRevision: latest.revision, idempotencyKey: "race-gender-retry" });
    }
    latest = await getAssessmentProgress(created.userId);
    expect(latest.answers.age).toBe(32);
    expect(latest.answers.gender).toBe("FEMALE");
  });

  it("keeps users isolated and blocks incomplete submission", async () => {
    const userA = await createAnonymousSession();
    const userB = await createAnonymousSession();
    await saveAssessmentStep({ userId: userA.userId, step: "age", data: { age: 44 }, baseRevision: 0, idempotencyKey: "user-a-age" });
    expect((await getAssessmentProgress(userB.userId)).answers.age).toBeNull();
    await expect(submitAssessment(userA.userId)).rejects.toThrow();
  });

  it("enforces numeric constraints in PostgreSQL", async () => {
    const created = await createAnonymousSession();
    await expect(getPrisma().assessment.update({
      where: { id: created.assessmentId },
      data: { age: 10 },
    })).rejects.toThrow();
  });
});

describe("access control and mock payment", () => {
  it("makes concurrent submissions converge on one persisted result", async () => {
    const created = await createAnonymousSession();
    await fillAssessment(created.userId);

    const submittedAt = new Date("2026-01-01T00:00:00Z");
    const results = await Promise.all([
      submitAssessment(created.userId, submittedAt),
      submitAssessment(created.userId, submittedAt),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await getPrisma().assessmentResult.count({
      where: { assessment: { userId: created.userId } },
    })).toBe(1);
  });

  it("returns the same persisted result when submit is replayed", async () => {
    const created = await createAnonymousSession();
    await completeAssessment(created.userId);
    const replay = await submitAssessment(created.userId, new Date("2027-01-01T00:00:00Z"));
    expect(replay.status).toBe("COMPLETED");
    expect(replay.calculatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects result access before calculation and can disable mock payment", async () => {
    const created = await createAnonymousSession();
    await expect(getResultForUser(created.userId)).rejects.toMatchObject({ code: "RESULT_NOT_READY" });
    const enabled = process.env.MOCK_PAY_ENABLED;
    process.env.MOCK_PAY_ENABLED = "false";
    await expect(activateMockSubscription({
      userId: created.userId,
      eventId: "disabled-payment",
      planCode: "demo_monthly",
    })).rejects.toMatchObject({ code: "MOCK_PAY_DISABLED" });
    process.env.MOCK_PAY_ENABLED = enabled;
  });

  it("changes the result from protected preview to full after payment", async () => {
    const created = await createAnonymousSession();
    await completeAssessment(created.userId);

    const preview = await getResultForUser(created.userId);
    expect(preview.access).toBe("PREVIEW");
    for (const protectedKey of ["estimatedBmr", "estimatedDailyCalories", "targetDate", "projection"]) {
      expect(hasKey(preview.access === "PREVIEW" ? preview.preview : preview, protectedKey)).toBe(false);
    }

    const paid = await activateMockSubscription({
      userId: created.userId,
      eventId: "payment-flow-001",
      planCode: "demo_monthly",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(paid.subscriptionStatus).toBe("ACTIVE");
    expect(paid.replayed).toBe(false);

    await getPrisma().subscription.update({
      where: { userId: created.userId },
      data: { expiresAt: null },
    });

    const replay = await activateMockSubscription({
      userId: created.userId,
      eventId: "payment-flow-001",
      planCode: "demo_monthly",
      now: new Date("2026-01-02T00:00:00Z"),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.expiresAt).toBeNull();

    const full = await getResultForUser(created.userId, new Date("2026-01-02T00:00:00Z"));
    expect(full.access).toBe("FULL");
    if (full.access === "FULL") {
      expect(full.result.projection).toBeInstanceOf(Array);
      expect(full.result.estimatedDailyCalories).toBeGreaterThan(0);
    }
  });

  it("does not grant access for an expired subscription", async () => {
    const created = await createAnonymousSession();
    await completeAssessment(created.userId);
    await activateMockSubscription({
      userId: created.userId,
      eventId: "payment-expired-001",
      planCode: "demo_monthly",
      now: new Date("2025-01-01T00:00:00Z"),
    });
    const expired = await getResultForUser(created.userId, new Date("2026-01-01T00:00:00Z"));
    expect(expired.access).toBe("PREVIEW");
    expect(expired.subscriptionStatus).toBe("EXPIRED");
  });

  it("supports active access without an expiry and preserves canceled status", async () => {
    const created = await createAnonymousSession();
    await completeAssessment(created.userId);
    await getPrisma().subscription.create({
      data: {
        userId: created.userId,
        status: "ACTIVE",
        planCode: "lifetime_demo",
        activatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const active = await getResultForUser(created.userId, new Date("2030-01-01T00:00:00Z"));
    expect(active.access).toBe("FULL");
    expect(active.subscriptionStatus).toBe("ACTIVE");

    await getPrisma().subscription.update({
      where: { userId: created.userId },
      data: { status: "CANCELED" },
    });
    const canceled = await getResultForUser(created.userId, new Date("2030-01-01T00:00:00Z"));
    expect(canceled.access).toBe("PREVIEW");
    expect(canceled.subscriptionStatus).toBe("CANCELED");
  });

  it("prevents a payment event from being replayed for another user", async () => {
    const first = await createAnonymousSession();
    const second = await createAnonymousSession();
    await activateMockSubscription({ userId: first.userId, eventId: "owned-payment-event", planCode: "demo_monthly" });
    await expect(activateMockSubscription({ userId: second.userId, eventId: "owned-payment-event", planCode: "demo_monthly" })).rejects.toMatchObject({
      code: "PAYMENT_EVENT_REUSED",
    });
  });
});
