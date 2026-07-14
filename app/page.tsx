"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StepKey } from "@/lib/assessment";

type Answers = {
  age: number | null;
  gender: string | null;
  goal: string | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  activityLevel: string | null;
};

type Progress = {
  assessmentId: string;
  status: string;
  revision: number;
  completedSteps: StepKey[];
  nextStep: StepKey | null;
  progressPercent: number;
  answers: Answers;
};

type PreviewResult = {
  access: "PREVIEW";
  subscriptionStatus: string;
  preview: { bmi: number; bmiCategory: string };
  lockedFields: string[];
  upgradeRequired: true;
};

type FullResult = {
  access: "FULL";
  subscriptionStatus: string;
  result: {
    bmi: number;
    bmiCategory: string;
    estimatedBmr: number;
    estimatedDailyCalories: number;
    targetDate: string;
    projection: Array<{ week: number; date: string; weightKg: number }>;
    algorithmVersion: string;
  };
  upgradeRequired: false;
};

type Result = PreviewResult | FullResult;
type Phase = "loading" | "welcome" | "quiz" | "analyzing" | "result";

const stepMeta: Record<StepKey, { eyebrow: string; title: string; hint: string }> = {
  age: { eyebrow: "先了解你", title: "你的年龄是？", hint: "年龄会影响基础能量消耗估算" },
  gender: { eyebrow: "身体基础", title: "用于计算的生理性别", hint: "仅用于本次能量估算" },
  goal: { eyebrow: "明确方向", title: "你最想实现什么？", hint: "目标决定计划的节奏" },
  height: { eyebrow: "身体数据", title: "你的身高是多少？", hint: "请输入 120–230 cm" },
  weight: { eyebrow: "身体数据", title: "你现在的体重？", hint: "请输入 30–300 kg" },
  "target-weight": { eyebrow: "设定目标", title: "你的目标体重？", hint: "我们会检查目标是否合理" },
  activity: { eyebrow: "最后一步", title: "你平时的运动频率？", hint: "这会影响每日能量消耗估算" },
};

const bmiLabels: Record<string, string> = {
  UNDERWEIGHT: "偏低",
  HEALTHY: "健康范围",
  OVERWEIGHT: "偏高",
  OBESITY: "较高",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.title ?? "请求失败") as Error & { status?: number; details?: unknown };
    error.status = response.status;
    error.details = body.details;
    throw error;
  }
  return body;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [step, setStep] = useState<StepKey>("age");
  const [answers, setAnswers] = useState<Answers>({
    age: null,
    gender: null,
    goal: null,
    heightCm: null,
    weightKg: null,
    targetWeightKg: null,
    activityLevel: null,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadResult = useCallback(async () => {
    const data = await api<Result>("/api/v1/assessments/current/result");
    setResult(data);
    setPhase("result");
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      let current: Progress;
      try {
        current = await api<Progress>("/api/v1/assessments/current");
      } catch (initialError) {
        if ((initialError as Error & { status?: number }).status !== 401) throw initialError;
        await api("/api/v1/sessions", { method: "POST", body: "{}" });
        current = await api<Progress>("/api/v1/assessments/current");
      }
      setProgress(current);
      setAnswers(current.answers);
      if (current.status === "COMPLETED") {
        await loadResult();
      } else if (current.completedSteps.length > 0) {
        setStep(current.nextStep ?? "age");
        setPhase("quiz");
      } else {
        setPhase("welcome");
      }
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : "初始化失败");
      setPhase("welcome");
    }
  }, [loadResult]);

  useEffect(() => {
    const task = window.setTimeout(() => void bootstrap(), 0);
    return () => window.clearTimeout(task);
  }, [bootstrap]);

  const currentIndex = Object.keys(stepMeta).indexOf(step);
  const visibleProgress = progress?.progressPercent ?? Math.round((currentIndex / 7) * 100);

  const stepData = useMemo(() => {
    switch (step) {
      case "age": return answers.age === null ? null : { age: answers.age };
      case "gender": return answers.gender ? { gender: answers.gender } : null;
      case "goal": return answers.goal ? { goal: answers.goal } : null;
      case "height": return answers.heightCm === null ? null : { heightCm: answers.heightCm };
      case "weight": return answers.weightKg === null ? null : { weightKg: answers.weightKg };
      case "target-weight": return answers.targetWeightKg === null ? null : { targetWeightKg: answers.targetWeightKg };
      case "activity": return answers.activityLevel ? { activityLevel: answers.activityLevel } : null;
    }
  }, [answers, step]);

  function updateNumber(key: keyof Answers, value: string) {
    setAnswers((current) => ({ ...current, [key]: value === "" ? null : Number(value) }));
    setError("");
  }

  async function finishAssessment() {
    setPhase("analyzing");
    await api("/api/v1/assessments/current/submit", { method: "POST", body: "{}" });
    await loadResult();
  }

  async function saveCurrentStep() {
    if (!progress || !stepData) return;
    setBusy(true);
    setError("");
    const idempotencyKey = crypto.randomUUID();

    async function save(baseRevision: number) {
      return api<Progress>(`/api/v1/assessments/current/steps/${step}`, {
        method: "PUT",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ data: stepData, baseRevision }),
      });
    }

    try {
      let updated: Progress;
      try {
        updated = await save(progress.revision);
      } catch (saveError) {
        if ((saveError as Error & { status?: number }).status !== 409) throw saveError;
        const latest = await api<Progress>("/api/v1/assessments/current");
        updated = await save(latest.revision);
      }
      setProgress(updated);
      setAnswers(updated.answers);
      if (updated.nextStep) setStep(updated.nextStep);
      else await finishAssessment();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (!progress) return;
    const index = Math.max(0, currentIndex - 1);
    setStep(Object.keys(stepMeta)[index] as StepKey);
    setError("");
  }

  async function unlock() {
    setBusy(true);
    setError("");
    try {
      await api("/api/v1/pay", {
        method: "POST",
        body: JSON.stringify({ eventId: `demo-${crypto.randomUUID()}`, planCode: "demo_monthly" }),
      });
      await loadResult();
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : "模拟支付失败");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "loading") {
    return <main className="center-screen"><div className="loader" /><p>正在恢复你的测评进度…</p></main>;
  }

  if (phase === "welcome") {
    return (
      <main className="landing">
        <nav className="brand"><span className="brand-mark">R</span>RuiFit</nav>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">3 分钟健康测评</p>
            <h1>更了解身体，<br />再开始改变。</h1>
            <p className="hero-text">根据你的目标、身体数据和活动习惯，生成一份清晰、可执行的健康趋势预览。</p>
            <button className="primary large" onClick={() => setPhase("quiz")}>开始免费测评 <span>→</span></button>
            <div className="trust-row"><span>✓ 无需注册</span><span>✓ 随时恢复</span><span>✓ 数据加密保存</span></div>
          </div>
          <div className="hero-card" aria-hidden="true">
            <div className="mini-ring"><strong>82%</strong><span>目标匹配度</span></div>
            <div className="mini-stat"><span>专属计划</span><strong>准备生成</strong></div>
            <div className="bars"><i /><i /><i /><i /><i /></div>
          </div>
        </section>
        {error && <p className="error landing-error" role="alert">{error}</p>}
        <footer>本测评仅提供一般性健康估算，不替代专业医疗建议。</footer>
      </main>
    );
  }

  if (phase === "analyzing") {
    return (
      <main className="center-screen analyzing">
        <div className="analysis-orbit"><span>R</span></div>
        <p className="eyebrow">正在生成你的结果</p>
        <h2>把每个答案变成清晰的下一步</h2>
        <div className="analysis-list"><span>✓ 身体指标已计算</span><span>✓ 活动水平已匹配</span><span>• 正在生成目标曲线</span></div>
      </main>
    );
  }

  if (phase === "result" && result) {
    const bmi = result.access === "FULL" ? result.result.bmi : result.preview.bmi;
    const category = result.access === "FULL" ? result.result.bmiCategory : result.preview.bmiCategory;
    return (
      <main className="result-page">
        <nav className="brand"><span className="brand-mark">R</span>RuiFit <em>你的健康报告</em></nav>
        <section className="result-hero">
          <p className="eyebrow">测评已完成</p>
          <h1>你的起点已经很清楚了。</h1>
          <p>以下结果基于你刚刚提交的身体数据和活动习惯。</p>
        </section>
        <section className="result-grid">
          <article className="metric-card accent"><span>身体质量指数 BMI</span><strong>{bmi}</strong><small>{bmiLabels[category] ?? category}</small></article>
          {result.access === "FULL" ? (
            <>
              <article className="metric-card"><span>建议每日摄入</span><strong>{result.result.estimatedDailyCalories}</strong><small>kcal / 天</small></article>
              <article className="metric-card"><span>预计达成日期</span><strong className="date-value">{result.result.targetDate}</strong><small>按当前目标节奏估算</small></article>
              <article className="chart-card">
                <div><span>目标体重趋势</span><small>完整预测曲线</small></div>
                <WeightChart points={result.result.projection} />
              </article>
              <article className="full-unlocked"><span>✓</span><div><strong>完整报告已解锁</strong><p>订阅状态已在服务端更新，刷新页面也不会丢失。</p></div></article>
            </>
          ) : (
            <>
              <article className="metric-card locked"><span>建议每日摄入</span><strong>••••</strong><small>解锁后查看精确数值</small></article>
              <article className="chart-card locked-chart">
                <div><span>目标体重趋势</span><small>你的完整预测曲线</small></div>
                <div className="fake-chart"><i /><i /><i /><i /><i /><i /></div>
                <div className="lock-pill">🔒 会员专属</div>
              </article>
              <article className="paywall">
                <p className="eyebrow">解锁完整报告</p>
                <h2>看见目标，也看见抵达的路径。</h2>
                <ul><li>每日建议摄入量</li><li>目标预测日期</li><li>每周体重趋势曲线</li></ul>
                <button className="primary large" disabled={busy} onClick={unlock}>{busy ? "处理中…" : "模拟支付并解锁"}</button>
                <small>演示环境不会产生真实扣款</small>
              </article>
            </>
          )}
        </section>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="disclaimer">结果为基于通用公式的演示估算，并非诊断或个体化医疗建议。</p>
      </main>
    );
  }

  const meta = stepMeta[step];
  return (
    <main className="quiz-shell">
      <nav className="quiz-nav"><div className="brand"><span className="brand-mark">R</span>RuiFit</div><span>{Math.min(currentIndex + 1, 7)} / 7</span></nav>
      <div className="progress-track"><div style={{ width: `${Math.max(visibleProgress, ((currentIndex + 1) / 7) * 100)}%` }} /></div>
      <section className="question-card">
        <p className="eyebrow">{meta.eyebrow}</p>
        <h1>{meta.title}</h1>
        <p className="question-hint">{meta.hint}</p>
        <div className="answer-area">{renderAnswer(step, answers, setAnswers, updateNumber)}</div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="quiz-actions">
          <button className="secondary" onClick={goBack} disabled={currentIndex === 0 || busy}>返回</button>
          <button className="primary" onClick={saveCurrentStep} disabled={!stepData || busy}>{busy ? "正在保存…" : "继续"}</button>
        </div>
        <p className="save-note">每一步都会安全保存，关闭页面后仍可继续</p>
      </section>
    </main>
  );
}

function renderAnswer(
  step: StepKey,
  answers: Answers,
  setAnswers: React.Dispatch<React.SetStateAction<Answers>>,
  updateNumber: (key: keyof Answers, value: string) => void,
) {
  const options = step === "gender"
    ? [["FEMALE", "女性"], ["MALE", "男性"]]
    : step === "goal"
      ? [["LOSE_WEIGHT", "健康减重", "循序渐进地接近目标"], ["MAINTAIN_WEIGHT", "保持状态", "稳定当前体重与活力"], ["GAIN_WEIGHT", "科学增重", "建立更适合自己的节奏"]]
      : step === "activity"
        ? [["SEDENTARY", "很少运动", "每周少于 1 次"], ["LIGHT", "偶尔运动", "每周 1–2 次"], ["MODERATE", "规律运动", "每周 3–4 次"], ["ACTIVE", "经常运动", "每周 5 次以上"]]
        : null;

  if (options) {
    const key = step === "gender" ? "gender" : step === "goal" ? "goal" : "activityLevel";
    return <div className="option-list">{options.map(([value, label, detail]) => (
      <button key={value} className={answers[key] === value ? "option selected" : "option"} onClick={() => setAnswers((current) => ({ ...current, [key]: value }))}>
        <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><i>{answers[key] === value ? "✓" : "→"}</i>
      </button>
    ))}</div>;
  }

  const config = step === "age"
    ? { key: "age" as const, unit: "岁", min: 18, max: 100, placeholder: "30" }
    : step === "height"
      ? { key: "heightCm" as const, unit: "cm", min: 120, max: 230, placeholder: "168" }
      : step === "weight"
        ? { key: "weightKg" as const, unit: "kg", min: 30, max: 300, placeholder: "65" }
        : { key: "targetWeightKg" as const, unit: "kg", min: 30, max: 300, placeholder: "58" };
  return (
    <label className="number-answer">
      <input aria-label={stepMeta[step].title} type="number" inputMode="decimal" min={config.min} max={config.max} step={config.key === "age" ? 1 : 0.1} placeholder={config.placeholder} value={answers[config.key] ?? ""} onChange={(event) => updateNumber(config.key, event.target.value)} autoFocus />
      <span>{config.unit}</span>
    </label>
  );
}

function WeightChart({ points }: { points: Array<{ week: number; weightKg: number }> }) {
  const sampled = points.length > 24 ? points.filter((_, index) => index % Math.ceil(points.length / 24) === 0 || index === points.length - 1) : points;
  const weights = sampled.map((point) => point.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = Math.max(1, max - min);
  const polyline = sampled.map((point, index) => `${(index / Math.max(1, sampled.length - 1)) * 100},${76 - ((point.weightKg - min) / range) * 56}`).join(" ");
  return (
    <div className="weight-chart">
      <svg viewBox="0 0 100 82" preserveAspectRatio="none" role="img" aria-label="每周目标体重趋势">
        <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <div><span>{weights[0]} kg</span><span>{weights.at(-1)} kg</span></div>
    </div>
  );
}
