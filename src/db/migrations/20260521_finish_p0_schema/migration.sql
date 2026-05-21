-- Remove extra_time_seconds (field confirmed absent from Carde API)
ALTER TABLE "rounds" DROP COLUMN IF EXISTS "extra_time_seconds";
ALTER TABLE "raw_carde_rounds" DROP COLUMN IF EXISTS "extra_time_seconds";

-- Add pf_id + round to raw_pf_extensions (both confirmed direct columns on tournament_logs)
ALTER TABLE "raw_pf_extensions" ADD COLUMN IF NOT EXISTS "pf_id" INTEGER;
ALTER TABLE "raw_pf_extensions" ADD COLUMN IF NOT EXISTS "round" INTEGER;

-- Add pf_id to extensions (needed for stable upsert key on PF extensions)
ALTER TABLE "extensions" ADD COLUMN IF NOT EXISTS "pf_id" TEXT;

-- Make table_judge_calls.round non-nullable (always known at fetch time from tournaments.round)
-- Backfill any legacy nulls to 0 so the ALTER doesn't fail on existing rows.
UPDATE "table_judge_calls" SET "round" = 0 WHERE "round" IS NULL;
ALTER TABLE "table_judge_calls" ALTER COLUMN "round" SET NOT NULL;

-- pf_session singleton: JWT metadata only, token never stored
CREATE TABLE IF NOT EXISTS "pf_session" (
    "id"         INTEGER     NOT NULL DEFAULT 1,
    "set_by"     TEXT        NOT NULL,
    "set_at"     TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ,
    CONSTRAINT "pf_session_pkey" PRIMARY KEY ("id")
);

-- Unique indexes for stable upserts
CREATE UNIQUE INDEX IF NOT EXISTS "extensions_pf_id_tournament_id_key"
    ON "extensions"("pf_id", "tournament_id");

CREATE UNIQUE INDEX IF NOT EXISTS "penalties_pf_id_tournament_id_key"
    ON "penalties"("pf_id", "tournament_id");

CREATE UNIQUE INDEX IF NOT EXISTS "table_judge_calls_tournament_id_table_number_round_key"
    ON "table_judge_calls"("tournament_id", "table_number", "round");
