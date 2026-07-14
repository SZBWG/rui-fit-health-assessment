# Database Schema

```mermaid
erDiagram
    USER ||--o{ AUTH_SESSION : owns
    USER ||--o{ ASSESSMENT : completes
    ASSESSMENT ||--o{ ASSESSMENT_UPDATE : records
    ASSESSMENT ||--o| ASSESSMENT_RESULT : produces
    USER ||--o| SUBSCRIPTION : owns
    USER ||--o{ PAYMENT_EVENT : triggers
    SUBSCRIPTION ||--o{ PAYMENT_EVENT : records

    USER {
      uuid id PK
      timestamptz created_at
      timestamptz updated_at
    }
    AUTH_SESSION {
      uuid id PK
      uuid user_id FK
      text token_hash UK
      timestamptz expires_at
    }
    ASSESSMENT {
      uuid id PK
      uuid user_id FK
      enum status
      int age
      enum gender
      enum goal
      float height_cm
      float weight_kg
      float target_weight_kg
      enum activity_level
      int revision
      int schema_version
    }
    ASSESSMENT_UPDATE {
      uuid id PK
      uuid assessment_id FK
      text idempotency_key UK
      text step_key
      text request_hash
      jsonb response
    }
    ASSESSMENT_RESULT {
      uuid assessment_id PK,FK
      float bmi
      text bmi_category
      int estimated_bmr
      int estimated_daily_calories
      date target_date
      jsonb projection
      text algorithm_version
      int source_revision
    }
    SUBSCRIPTION {
      uuid id PK
      uuid user_id FK,UK
      enum status
      text plan_code
      timestamptz activated_at
      timestamptz expires_at
    }
    PAYMENT_EVENT {
      uuid id PK
      text provider_event_id UK
      uuid user_id FK
      uuid subscription_id FK
      enum status
      jsonb raw_payload
    }
```

## 关键约束

- 身高、体重、年龄同时受 API Schema 和 PostgreSQL `CHECK` 约束保护。
- `assessment_updates(assessment_id, idempotency_key)` 唯一，保证步骤请求可安全重放。
- `payment_events.provider_event_id` 全局唯一，保证支付事件可安全重放。
- `assessments.revision` 用于乐观并发控制；冲突返回 409，不做静默覆盖。
- `assessment_results.source_revision` 和 `algorithm_version` 让历史结果可以复现。
- Session 只存 HMAC-SHA256 哈希，不保存原始访问令牌。
