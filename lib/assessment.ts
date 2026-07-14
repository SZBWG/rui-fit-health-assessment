import { createHash } from "node:crypto";
import { z } from "zod";

export const STEP_ORDER = [
  "age",
  "gender",
  "goal",
  "height",
  "weight",
  "target-weight",
  "activity",
] as const;

export const stepKeySchema = z.enum(STEP_ORDER);
export type StepKey = z.infer<typeof stepKeySchema>;

const ageSchema = z.number().int().min(18).max(100);
const heightSchema = z.number().finite().min(120).max(230);
const weightSchema = z.number().finite().min(30).max(300);
const genderSchema = z.enum(["MALE", "FEMALE"]);
const goalSchema = z.enum(["LOSE_WEIGHT", "MAINTAIN_WEIGHT", "GAIN_WEIGHT"]);
const activitySchema = z.enum(["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE"]);

export const saveStepBodySchema = z
  .object({
    data: z.unknown(),
    baseRevision: z.number().int().nonnegative(),
  })
  .strict();

export const fullAssessmentSchema = z
  .object({
    age: ageSchema,
    gender: genderSchema,
    goal: goalSchema,
    heightCm: heightSchema,
    weightKg: weightSchema,
    targetWeightKg: weightSchema,
    activityLevel: activitySchema,
  })
  .strict()
  .superRefine((input, context) => {
    const currentBmi = input.weightKg / (input.heightCm / 100) ** 2;
    const targetBmi = input.targetWeightKg / (input.heightCm / 100) ** 2;
    const relativeChange = Math.abs(input.targetWeightKg - input.weightKg) / input.weightKg;

    if (currentBmi < 10 || currentBmi > 80) {
      context.addIssue({ code: "custom", path: ["weightKg"], message: "Current BMI is outside the supported range" });
    }
    if (targetBmi < 14 || targetBmi > 60) {
      context.addIssue({ code: "custom", path: ["targetWeightKg"], message: "Target BMI is outside the supported range" });
    }
    if (relativeChange > 0.5) {
      context.addIssue({ code: "custom", path: ["targetWeightKg"], message: "Target weight change cannot exceed 50%" });
    }
    if (input.goal === "LOSE_WEIGHT" && input.targetWeightKg >= input.weightKg) {
      context.addIssue({ code: "custom", path: ["targetWeightKg"], message: "A weight-loss target must be below current weight" });
    }
    if (input.goal === "GAIN_WEIGHT" && input.targetWeightKg <= input.weightKg) {
      context.addIssue({ code: "custom", path: ["targetWeightKg"], message: "A weight-gain target must be above current weight" });
    }
    if (input.goal === "MAINTAIN_WEIGHT" && Math.abs(input.targetWeightKg - input.weightKg) > 2) {
      context.addIssue({ code: "custom", path: ["targetWeightKg"], message: "A maintenance target must stay within 2 kg" });
    }

    const weeklyRate = input.goal === "GAIN_WEIGHT" ? 0.25 : 0.5;
    const weeks = Math.ceil(Math.abs(input.targetWeightKg - input.weightKg) / weeklyRate);
    if (weeks > 104) {
      context.addIssue({ code: "custom", path: ["targetWeightKg"], message: "Target date would exceed the supported two-year plan" });
    }
  });

export type AssessmentInput = z.infer<typeof fullAssessmentSchema>;

export function parseStepData(step: StepKey, data: unknown) {
  switch (step) {
    case "age":
      return z.object({ age: ageSchema }).strict().parse(data);
    case "gender":
      return z.object({ gender: genderSchema }).strict().parse(data);
    case "goal":
      return z.object({ goal: goalSchema }).strict().parse(data);
    case "height":
      return z.object({ heightCm: heightSchema }).strict().parse(data);
    case "weight":
      return z.object({ weightKg: weightSchema }).strict().parse(data);
    case "target-weight":
      return z.object({ targetWeightKg: weightSchema }).strict().parse(data);
    case "activity":
      return z.object({ activityLevel: activitySchema }).strict().parse(data);
  }
}

export type AssessmentRecord = {
  id: string;
  status: string;
  age: number | null;
  gender: string | null;
  goal: string | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  activityLevel: string | null;
  revision: number;
  schemaVersion: number;
  submittedAt: Date | null;
  updatedAt: Date;
};

function completed(record: AssessmentRecord, step: StepKey) {
  switch (step) {
    case "age": return record.age !== null;
    case "gender": return record.gender !== null;
    case "goal": return record.goal !== null;
    case "height": return record.heightCm !== null;
    case "weight": return record.weightKg !== null;
    case "target-weight": return record.targetWeightKg !== null;
    case "activity": return record.activityLevel !== null;
  }
}

export function assessmentProgress(record: AssessmentRecord) {
  const completedSteps = STEP_ORDER.filter((step) => completed(record, step));
  return {
    assessmentId: record.id,
    status: record.status,
    revision: record.revision,
    schemaVersion: record.schemaVersion,
    completedSteps,
    nextStep: STEP_ORDER.find((step) => !completedSteps.includes(step)) ?? null,
    progressPercent: Math.round((completedSteps.length / STEP_ORDER.length) * 100),
    answers: {
      age: record.age,
      gender: record.gender,
      goal: record.goal,
      heightCm: record.heightCm,
      weightKg: record.weightKg,
      targetWeightKg: record.targetWeightKg,
      activityLevel: record.activityLevel,
    },
    submittedAt: record.submittedAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function inputFromAssessment(record: AssessmentRecord) {
  return fullAssessmentSchema.parse({
    age: record.age,
    gender: record.gender,
    goal: record.goal,
    heightCm: record.heightCm,
    weightKg: record.weightKg,
    targetWeightKg: record.targetWeightKg,
    activityLevel: record.activityLevel,
  });
}

export type ProjectionPoint = { week: number; date: string; weightKg: number };

export function calculateHealthAssessment(input: AssessmentInput, now = new Date()) {
  const parsed = fullAssessmentSchema.parse(input);
  const heightM = parsed.heightCm / 100;
  const rawBmi = parsed.weightKg / heightM ** 2;
  const bmi = Math.round(rawBmi * 10) / 10;
  const bmiCategory = rawBmi < 18.5 ? "UNDERWEIGHT" : rawBmi < 25 ? "HEALTHY" : rawBmi < 30 ? "OVERWEIGHT" : "OBESITY";
  const sexAdjustment = parsed.gender === "MALE" ? 5 : -161;
  const bmr = Math.round(10 * parsed.weightKg + 6.25 * parsed.heightCm - 5 * parsed.age + sexAdjustment);
  const activityFactor = {
    SEDENTARY: 1.2,
    LIGHT: 1.375,
    MODERATE: 1.55,
    ACTIVE: 1.725,
  }[parsed.activityLevel];
  const maintenanceCalories = Math.round(bmr * activityFactor);
  const goalAdjustment = parsed.goal === "LOSE_WEIGHT" ? -400 : parsed.goal === "GAIN_WEIGHT" ? 300 : 0;
  const estimatedDailyCalories = Math.max(bmr, maintenanceCalories + goalAdjustment);
  const weeklyRate = parsed.goal === "GAIN_WEIGHT" ? 0.25 : parsed.goal === "MAINTAIN_WEIGHT" ? 0 : 0.5;
  const direction = Math.sign(parsed.targetWeightKg - parsed.weightKg);
  const weeks = weeklyRate === 0 ? 0 : Math.ceil(Math.abs(parsed.targetWeightKg - parsed.weightKg) / weeklyRate);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const projection: ProjectionPoint[] = Array.from({ length: weeks + 1 }, (_, week) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + week * 7);
    const projected = parsed.weightKg + direction * weeklyRate * week;
    return {
      week,
      date: date.toISOString().slice(0, 10),
      weightKg: Math.round((direction > 0 ? Math.min(projected, parsed.targetWeightKg) : Math.max(projected, parsed.targetWeightKg)) * 10) / 10,
    };
  });
  const targetDate = new Date(start);
  targetDate.setUTCDate(targetDate.getUTCDate() + weeks * 7);

  return {
    bmi,
    bmiCategory,
    estimatedBmr: bmr,
    maintenanceCalories,
    estimatedDailyCalories,
    targetDate,
    projection,
    algorithmVersion: "v1",
  };
}

export function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
