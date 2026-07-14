import "dotenv/config";
import { hashSessionToken } from "@/lib/auth";
import { calculateHealthAssessment, type AssessmentInput } from "@/lib/assessment";
import { getPrisma } from "@/lib/prisma";

const prisma = getPrisma();
const expiresAt = new Date("2030-01-01T00:00:00Z");
const input: AssessmentInput = {
  age: 32,
  gender: "FEMALE",
  goal: "LOSE_WEIGHT",
  heightCm: 168,
  weightKg: 70,
  targetWeightKg: 62,
  activityLevel: "MODERATE",
};

const demos = [
  {
    kind: "free",
    token: "demo-free-token-2026-rui-fit",
    userId: "00000000-0000-4000-8000-000000000101",
    sessionId: "00000000-0000-4000-8000-000000000201",
    assessmentId: "00000000-0000-4000-8000-000000000301",
    paid: false,
  },
  {
    kind: "paid",
    token: "demo-paid-token-2026-rui-fit",
    userId: "00000000-0000-4000-8000-000000000102",
    sessionId: "00000000-0000-4000-8000-000000000202",
    assessmentId: "00000000-0000-4000-8000-000000000302",
    paid: true,
  },
] as const;

for (const demo of demos) {
  await prisma.user.deleteMany({ where: { id: demo.userId } });
  const calculatedAt = new Date("2026-07-14T00:00:00Z");
  const result = calculateHealthAssessment(input, calculatedAt);
  await prisma.user.create({
    data: {
      id: demo.userId,
      sessions: {
        create: {
          id: demo.sessionId,
          tokenHash: hashSessionToken(demo.token),
          expiresAt,
        },
      },
      assessments: {
        create: {
          id: demo.assessmentId,
          status: "COMPLETED",
          ...input,
          revision: 7,
          submittedAt: calculatedAt,
          result: {
            create: {
              bmi: result.bmi,
              bmiCategory: result.bmiCategory,
              estimatedBmr: result.estimatedBmr,
              estimatedDailyCalories: result.estimatedDailyCalories,
              targetDate: result.targetDate,
              projection: result.projection,
              algorithmVersion: result.algorithmVersion,
              sourceRevision: 7,
              calculatedAt,
            },
          },
        },
      },
      ...(demo.paid ? {
        subscription: {
          create: {
            id: "00000000-0000-4000-8000-000000000402",
            status: "ACTIVE" as const,
            activatedAt: calculatedAt,
            expiresAt,
            payments: {
              create: {
                id: "00000000-0000-4000-8000-000000000502",
                providerEventId: "seed-paid-demo-2026",
                userId: demo.userId,
                status: "SUCCEEDED" as const,
                rawPayload: { seeded: true },
              },
            },
          },
        },
      } : {}),
    },
  });
}

console.log(JSON.stringify(demos.map(({ kind, sessionId, token }) => ({ kind, sessionId, token })), null, 2));
await prisma.$disconnect();
