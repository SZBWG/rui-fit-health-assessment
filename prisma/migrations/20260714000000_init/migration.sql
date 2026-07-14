CREATE TYPE "AssessmentStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "Goal" AS ENUM ('LOSE_WEIGHT', 'MAINTAIN_WEIGHT', 'GAIN_WEIGHT');
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'EXPIRED', 'CANCELED');
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assessments" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "AssessmentStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "age" INTEGER,
  "gender" "Gender",
  "goal" "Goal",
  "height_cm" DOUBLE PRECISION,
  "weight_kg" DOUBLE PRECISION,
  "target_weight_kg" DOUBLE PRECISION,
  "activity_level" "ActivityLevel",
  "revision" INTEGER NOT NULL DEFAULT 0,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "submitted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "assessments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assessments_age_check" CHECK ("age" IS NULL OR "age" BETWEEN 18 AND 100),
  CONSTRAINT "assessments_height_check" CHECK ("height_cm" IS NULL OR "height_cm" BETWEEN 120 AND 230),
  CONSTRAINT "assessments_weight_check" CHECK ("weight_kg" IS NULL OR "weight_kg" BETWEEN 30 AND 300),
  CONSTRAINT "assessments_target_weight_check" CHECK ("target_weight_kg" IS NULL OR "target_weight_kg" BETWEEN 30 AND 300),
  CONSTRAINT "assessments_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "assessments_schema_version_check" CHECK ("schema_version" > 0),
  CONSTRAINT "assessments_goal_direction_check" CHECK (
    "goal" IS NULL OR "weight_kg" IS NULL OR "target_weight_kg" IS NULL OR
    ("goal" = 'LOSE_WEIGHT' AND "target_weight_kg" < "weight_kg") OR
    ("goal" = 'GAIN_WEIGHT' AND "target_weight_kg" > "weight_kg") OR
    ("goal" = 'MAINTAIN_WEIGHT' AND ABS("target_weight_kg" - "weight_kg") <= 2)
  )
);

CREATE TABLE "assessment_updates" (
  "id" UUID NOT NULL,
  "assessment_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "step_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessment_updates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assessment_results" (
  "assessment_id" UUID NOT NULL,
  "bmi" DOUBLE PRECISION NOT NULL,
  "bmi_category" TEXT NOT NULL,
  "estimated_bmr" INTEGER NOT NULL,
  "estimated_daily_calories" INTEGER NOT NULL,
  "target_date" DATE NOT NULL,
  "projection" JSONB NOT NULL,
  "algorithm_version" TEXT NOT NULL,
  "source_revision" INTEGER NOT NULL,
  "calculated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("assessment_id"),
  CONSTRAINT "assessment_results_bmi_check" CHECK ("bmi" > 0),
  CONSTRAINT "assessment_results_calories_check" CHECK ("estimated_bmr" > 0 AND "estimated_daily_calories" > 0),
  CONSTRAINT "assessment_results_revision_check" CHECK ("source_revision" >= 0)
);

CREATE TABLE "subscriptions" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
  "plan_code" TEXT NOT NULL DEFAULT 'demo_monthly',
  "activated_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_expiry_check" CHECK ("expires_at" IS NULL OR "activated_at" IS NULL OR "expires_at" > "activated_at")
);

CREATE TABLE "payment_events" (
  "id" UUID NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_events_provider_id_check" CHECK (LENGTH("provider_event_id") BETWEEN 8 AND 100)
);

CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
CREATE INDEX "assessments_user_id_created_at_idx" ON "assessments"("user_id", "created_at");
CREATE INDEX "assessment_updates_assessment_id_created_at_idx" ON "assessment_updates"("assessment_id", "created_at");
CREATE UNIQUE INDEX "assessment_updates_assessment_id_idempotency_key_key" ON "assessment_updates"("assessment_id", "idempotency_key");
CREATE UNIQUE INDEX "subscriptions_user_id_key" ON "subscriptions"("user_id");
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider_event_id");
CREATE INDEX "payment_events_user_id_created_at_idx" ON "payment_events"("user_id", "created_at");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_updates" ADD CONSTRAINT "assessment_updates_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
