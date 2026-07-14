import { describe, expect, it } from "vitest";
import {
  calculateHealthAssessment,
  fullAssessmentSchema,
  parseStepData,
  type AssessmentInput,
} from "@/lib/assessment";

const base: AssessmentInput = {
  age: 30,
  gender: "MALE",
  goal: "LOSE_WEIGHT",
  heightCm: 180,
  weightKg: 80,
  targetWeightKg: 72,
  activityLevel: "MODERATE",
};

describe("health assessment algorithm", () => {
  it("calculates deterministic BMI, calories, date and projection", () => {
    const result = calculateHealthAssessment(base, new Date("2026-01-01T18:30:00Z"));

    expect(result.bmi).toBe(24.7);
    expect(result.bmiCategory).toBe("HEALTHY");
    expect(result.estimatedBmr).toBe(1780);
    expect(result.maintenanceCalories).toBe(2759);
    expect(result.estimatedDailyCalories).toBe(2359);
    expect(result.targetDate.toISOString().slice(0, 10)).toBe("2026-04-23");
    expect(result.projection).toHaveLength(17);
    expect(result.projection.at(-1)?.weightKg).toBe(72);
    expect(result.algorithmVersion).toBe("v1");
  });

  it.each([
    [73.9, "UNDERWEIGHT"],
    [74, "HEALTHY"],
    [100, "OVERWEIGHT"],
    [120, "OBESITY"],
  ])("classifies BMI boundary weight %s as %s", (weightKg, category) => {
    const result = calculateHealthAssessment({
      ...base,
      goal: "MAINTAIN_WEIGHT",
      heightCm: 200,
      weightKg,
      targetWeightKg: weightKg,
    });
    expect(result.bmiCategory).toBe(category);
  });

  it("never recommends less than estimated resting energy", () => {
    const result = calculateHealthAssessment({
      ...base,
      gender: "FEMALE",
      age: 100,
      heightCm: 120,
      weightKg: 31,
      targetWeightKg: 30,
    });
    expect(result.estimatedDailyCalories).toBeGreaterThanOrEqual(result.estimatedBmr);
    expect(Number.isFinite(result.estimatedDailyCalories)).toBe(true);
  });
});

describe("assessment validation", () => {
  it.each([
    ["age below minimum", { age: 17 }],
    ["age above maximum", { age: 101 }],
    ["fractional age", { age: 20.5 }],
    ["height below minimum", { heightCm: 119.9 }],
    ["height above maximum", { heightCm: 230.1 }],
    ["weight below minimum", { weightKg: 29.9 }],
    ["weight above maximum", { weightKg: 300.1 }],
    ["non-finite height", { heightCm: Number.POSITIVE_INFINITY }],
    ["loss target above current", { targetWeightKg: 81 }],
    ["implausible target change", { targetWeightKg: 39 }],
  ])("rejects %s", (_, patch) => {
    expect(fullAssessmentSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it("rejects missing and unknown fields", () => {
    expect(fullAssessmentSchema.safeParse({ ...base, age: undefined }).success).toBe(false);
    expect(fullAssessmentSchema.safeParse({ ...base, subscriptionStatus: "ACTIVE" }).success).toBe(false);
  });

  it("rejects string-based numeric injection", () => {
    expect(() => parseStepData("weight", { weightKg: "70 OR 1=1" })).toThrow();
  });
});
