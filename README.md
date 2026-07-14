# RuiFit 健康测评

[![CI](https://github.com/SZBWG/rui-fit-health-assessment/actions/workflows/ci.yml/badge.svg)](https://github.com/SZBWG/rui-fit-health-assessment/actions/workflows/ci.yml)

一个围绕“分步保存 → 中断恢复 → 服务端计算 → 权限裁剪 → 模拟支付 → 完整结果”构建的全栈健康测评系统。

> 线上演示：[https://rui-fit-health-assessment.vercel.app](https://rui-fit-health-assessment.vercel.app)

## 核心能力

- 7 步移动端 Funnel，每步服务端持久化，刷新或关闭后可以继续。
- 匿名 Session 使用 HttpOnly Cookie；数据库只保存 Token 的 HMAC-SHA256 哈希。
- 步骤请求支持幂等键、乱序写入和 revision 乐观并发控制。
- 服务端计算 BMI、静息能量、建议摄入量、目标日期与每周趋势。
- 非会员 API 使用独立白名单 DTO，不下发预测曲线等受保护数据。
- `/api/v1/pay` 在事务内记录唯一支付事件并激活订阅，可以安全重放。
- PostgreSQL 约束、单元测试、数据库集成测试和 Playwright E2E 共同验证闭环。

## 技术栈

- Next.js App Router、React、TypeScript
- Prisma ORM 7、PostgreSQL
- Zod
- Vitest、Playwright
- GitHub Actions

## 本地启动

要求 Node.js 24。本地 PostgreSQL 使用 Prisma Dev，不要求 Docker。

```bash
npm install
cp .env.example .env
npm run setup
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

`npm run setup` 会启动隔离的本地 PostgreSQL、应用版本化迁移并写入免费/已支付演示数据。

## 环境变量

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | 应用运行时 PostgreSQL 连接 |
| `MIGRATION_DATABASE_URL` | Prisma CLI 和迁移使用的直接连接 |
| `SHADOW_DATABASE_URL` | 仅 `migrate dev` 需要；生产部署不设置 |
| `SESSION_SECRET` | 至少 32 字符，用于 Session Token HMAC |
| `MOCK_PAY_ENABLED` | 挑战演示环境设为 `true` |
| `NEXT_PUBLIC_APP_URL` | 应用公网根地址 |

生产环境先执行：

```bash
npm run db:deploy
npm run db:seed
npm run build
```

## API

完整契约见 [`docs/openapi.yaml`](docs/openapi.yaml)。所有业务错误使用 `application/problem+json`，并包含稳定的 `code`。

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/v1/sessions` | 创建匿名身份和测评 |
| GET | `/api/v1/assessments/current` | 恢复进度 |
| PUT | `/api/v1/assessments/current/steps/:stepKey` | 保存完整步骤 |
| POST | `/api/v1/assessments/current/submit` | 校验并计算结果 |
| GET | `/api/v1/assessments/current/result` | 返回免费预览或会员完整结果 |
| POST | `/api/v1/pay` | 模拟支付并激活订阅 |

### 可重放 `/pay` 调用

```bash
BASE_URL=https://rui-fit-health-assessment.vercel.app
TOKEN=demo-paid-token-2026-rui-fit

curl -X POST "$BASE_URL/api/v1/pay" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"eventId":"review-payment-001","planCode":"demo_monthly"}'
```

用同一个 `eventId` 再调用一次会返回 `"replayed": true`，不会新增第二个支付事件。
示例使用已支付 Session，避免改变下方固定免费 Session 的对比状态；完整的“免费 → 支付 → 解锁”可直接在线上 Funnel 演示。

### 免费与已支付演示 Session

| 状态 | sessionId | Bearer Token |
|---|---|---|
| 免费 | `00000000-0000-4000-8000-000000000201` | `demo-free-token-2026-rui-fit` |
| 已支付 | `00000000-0000-4000-8000-000000000202` | `demo-paid-token-2026-rui-fit` |

直接比较结果：

```bash
curl -H "Authorization: Bearer demo-free-token-2026-rui-fit" \
  "$BASE_URL/api/v1/assessments/current/result"

curl -H "Authorization: Bearer demo-paid-token-2026-rui-fit" \
  "$BASE_URL/api/v1/assessments/current/result"
```

免费响应只包含 BMI 预览；已支付响应包含建议摄入量、目标日期和完整 `projection`。

## 并发与幂等约定

- 客户端保存步骤时提交当前 `baseRevision` 和唯一 `Idempotency-Key`。
- 相同 Key、相同请求返回第一次的响应，不增加 revision。
- 相同 Key、不同请求返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 两个相同 revision 的并发更新只有一个成功；另一个返回 `409 REVISION_CONFLICT` 和最新 revision。
- 客户端获取最新状态后重试，因此不会静默覆盖其他更新。
- 支付使用唯一 `providerEventId` 实现独立的幂等闭环。

## 算法

- BMI：`weightKg / heightM²`。
- BMI 使用未舍入值分类，仅显示值保留一位小数。
- 静息能量采用 Mifflin–St Jeor 估算。
- 日消耗为静息能量乘活动系数。
- 减重按每周 0.5kg、增重按每周 0.25kg 生成演示预测。
- 结果保存 `algorithmVersion` 和 `sourceRevision`，便于复现。

该算法只用于工程挑战演示，不构成诊断或个体化医疗建议。

## 测试与质量

```bash
npm test              # 单元 + PostgreSQL 集成测试
npm run test:coverage # 强制覆盖率阈值
npm run test:e2e      # 浏览器完整 Funnel
npm run verify        # lint + 类型 + 覆盖率 + build + E2E

# 对已部署环境执行同一条浏览器闭环
PLAYWRIGHT_BASE_URL=https://rui-fit-health-assessment.vercel.app npm run test:e2e
```

当前覆盖：

- 公式结果、BMI 分类临界点、固定目标日期。
- 缺失、错误类型、NaN/Infinity、越界和跨字段目标冲突。
- 分步保存、恢复、乱序、重复、幂等键复用。
- 并发冲突与重试后无丢失更新。
- Session 缺失、过期和用户隔离。
- 非会员字段白名单、会员完整结果、订阅过期。
- `/pay` 状态变化、事件重放、跨用户事件盗用。
- PostgreSQL 协议冲突的重试、快速失败和重试上限。
- 浏览器刷新恢复、从第一题到付费解锁、付费后再次刷新。
- PostgreSQL `CHECK` 约束。

核心模块覆盖率门槛：行 80%、语句 80%、函数 80%、分支 75%。最近一次本地完整验证为行 89.5%、语句 88.18%、函数 96.87%、分支 83.33%；GitHub CI 运行相同门禁。

暂未覆盖：

- 真实支付平台的签名、退款和 webhook 重试；本题明确要求模拟支付。
- 跨设备账户找回；当前是匿名 Session，没有注册系统。
- 医学有效性试验；当前算法是注明限制的工程演示。
- 压力与容量测试；当前没有足够的真实流量模型。

GitHub Actions 使用真实 PostgreSQL 17 服务运行相同验证命令。

## 数据库与 AI 复盘

- [Schema 图与约束说明](docs/schema.md)
- [AI 使用及否决案例](docs/ai-retrospective.md)

## 安全说明

- 用户 ID 不作为身份凭证。
- 原始 Session Token 不落库。
- 服务端从 Session 推导 userId，客户端不能写会员状态或计算结果。
- 免费 DTO 不包含受保护字段，而不是在完整对象上临时删除字段。
- Mock Pay 仅在 `MOCK_PAY_ENABLED=true` 时存在；真实系统必须替换成支付平台签名验证。
