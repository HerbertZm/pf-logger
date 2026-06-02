-- Remove extra_time_seconds from rounds — confirmed this field does not exist in Carde API.
-- Round timer adjustments are absorbed into event-level timer_end_datetime (which we compute locally).
ALTER TABLE "rounds" DROP COLUMN IF EXISTS "extra_time_seconds";
ALTER TABLE "raw_carde_rounds" DROP COLUMN IF EXISTS "extra_time_seconds";

-- Add pf_id and round to raw_pf_extensions — both confirmed as direct columns on PF tournament_logs.
-- pf_id is the auto-increment integer PK on tournament_logs.
-- round is a direct column — no timestamp inference needed.
ALTER TABLE "raw_pf_extensions" ADD COLUMN IF NOT EXISTS "pf_id" INTEGER;
ALTER TABLE "raw_pf_extensions" ADD COLUMN IF NOT EXISTS "round" INTEGER;

-- pf_session singleton table — JWT metadata only, token never stored.
CREATE TABLE IF NOT EXISTS "pf_session" (
    "id"         INTEGER     NOT NULL DEFAULT 1,
    "set_by"     TEXT        NOT NULL,
    "set_at"     TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ,
    CONSTRAINT "pf_session_pkey" PRIMARY KEY ("id")
);
