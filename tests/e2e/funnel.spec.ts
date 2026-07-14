import { expect, test } from "@playwright/test";

test("restores progress, protects preview fields, and unlocks after mock payment", async ({ page }) => {
  const resultResponses: unknown[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/v1/assessments/current/result") && response.ok()) {
      resultResponses.push(await response.json());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /更了解身体/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /开始免费测评/ }).click();

  await page.getByRole("spinbutton", { name: "你的年龄是？" }).fill("32");
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByRole("heading", { name: "用于计算的生理性别" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "用于计算的生理性别" })).toBeVisible();
  await page.getByRole("button", { name: /女性/ }).click();
  await page.getByRole("button", { name: "继续" }).click();

  await page.getByRole("button", { name: /健康减重/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("spinbutton", { name: "你的身高是多少？" }).fill("168");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("spinbutton", { name: "你现在的体重？" }).fill("70");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("spinbutton", { name: "你的目标体重？" }).fill("62");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: /规律运动/ }).click();
  await page.getByRole("button", { name: "继续" }).click();

  await expect(page.getByRole("button", { name: "模拟支付并解锁" })).toBeVisible({ timeout: 20_000 });
  const preview = resultResponses.find((body) => (body as { access?: string }).access === "PREVIEW") as Record<string, unknown>;
  expect(preview).toBeTruthy();
  expect(preview).not.toHaveProperty("result");
  expect(preview.preview).not.toHaveProperty("estimatedDailyCalories");
  expect(preview.preview).not.toHaveProperty("targetDate");
  expect(preview.preview).not.toHaveProperty("projection");

  await page.getByRole("button", { name: "模拟支付并解锁" }).click();
  await expect(page.getByText("完整报告已解锁")).toBeVisible();
  await expect(page.getByText("完整预测曲线")).toBeVisible();
  await expect(page.locator(".weight-chart svg")).toBeVisible();

  await page.reload();
  await expect(page.getByText("完整报告已解锁")).toBeVisible();
});
