-- CreateTable
CREATE TABLE "app_tournaments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_ended" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_source_mapping" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "carde_first_round_id" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "tournament_source_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_sessions" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_activity" (
    "id" SERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_state" (
    "tournament_id" INTEGER NOT NULL,
    "last_rounds_fetched_at" TIMESTAMPTZ,
    "last_matches_fetched_at" TIMESTAMPTZ,
    "last_pf_fetched_at" TIMESTAMPTZ,
    "current_round" INTEGER,
    "is_running" BOOLEAN NOT NULL DEFAULT false,
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_state_pkey" PRIMARY KEY ("tournament_id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "round_number" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "carde_round_id" INTEGER NOT NULL,
    "carde_status" TEXT,
    "started_at" TIMESTAMPTZ,
    "timer_duration_min" INTEGER,
    "extra_time_seconds" INTEGER NOT NULL DEFAULT 0,
    "timer_end_datetime" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "missing_tables_json" JSONB,
    "snapshot_captured_at" TIMESTAMPTZ,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "round_id" INTEGER NOT NULL,
    "round_number" INTEGER NOT NULL,
    "table_number" INTEGER NOT NULL,
    "carde_match_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "time_extension_sec" INTEGER NOT NULL DEFAULT 0,
    "is_ghost_match" BOOLEAN NOT NULL DEFAULT false,
    "is_bye" BOOLEAN NOT NULL DEFAULT false,
    "match_is_loss" BOOLEAN NOT NULL DEFAULT false,
    "match_is_intentional_draw" BOOLEAN NOT NULL DEFAULT false,
    "match_is_unintentional_draw" BOOLEAN NOT NULL DEFAULT false,
    "deck_check_started" BOOLEAN NOT NULL DEFAULT false,
    "deck_check_completed" BOOLEAN NOT NULL DEFAULT false,
    "assigned_judge" TEXT,
    "result_reported_at" TIMESTAMPTZ,
    "result_at" TIMESTAMPTZ,
    "p1_user_id" TEXT,
    "p1_name" TEXT,
    "p2_user_id" TEXT,
    "p2_name" TEXT,
    "winning_player_id" TEXT,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drops" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "player_game_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "table_number" INTEGER,
    "player_name" TEXT,
    "is_checked" BOOLEAN NOT NULL DEFAULT false,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "added_by_name" TEXT,
    "verified_by_name" TEXT,
    "updated_by" TEXT,
    "source" TEXT NOT NULL DEFAULT 'purplefox',

    CONSTRAINT "drops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalties" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "pf_id" TEXT,
    "round" INTEGER,
    "player_game_id" TEXT,
    "player_name" TEXT,
    "description" TEXT NOT NULL,
    "infraction" TEXT,
    "sanction" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "creator_id" TEXT,
    "creator_name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'purplefox',

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extensions" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "round_id" INTEGER,
    "round" INTEGER,
    "table_number" INTEGER NOT NULL,
    "from_minutes" INTEGER,
    "to_minutes" INTEGER,
    "extension_minutes" INTEGER,
    "action_text" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_coverage" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "round" INTEGER,
    "table_number" INTEGER NOT NULL,
    "covered_by" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "table_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_judge_calls" (
    "id" SERIAL NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "round" INTEGER,
    "table_number" INTEGER NOT NULL,
    "judge" TEXT,
    "judge_result" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "table_judge_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pf_staff" (
    "id" SERIAL NOT NULL,
    "pf_user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pf_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_carde_rounds" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "carde_tournament_id" INTEGER NOT NULL,
    "carde_round_id" INTEGER NOT NULL,
    "round_number" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "timer_duration_min" INTEGER,
    "extra_time_seconds" INTEGER NOT NULL DEFAULT 0,
    "carde_status" TEXT,
    "pairings_status" TEXT,
    "raw_payload" JSONB,

    CONSTRAINT "raw_carde_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_carde_matches" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "carde_round_id" INTEGER NOT NULL,
    "round_number" INTEGER NOT NULL,
    "table_number" INTEGER NOT NULL,
    "carde_match_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "time_extension_sec" INTEGER NOT NULL DEFAULT 0,
    "is_ghost_match" BOOLEAN NOT NULL DEFAULT false,
    "is_bye" BOOLEAN NOT NULL DEFAULT false,
    "match_is_loss" BOOLEAN NOT NULL DEFAULT false,
    "match_is_intentional_draw" BOOLEAN NOT NULL DEFAULT false,
    "match_is_unintentional_draw" BOOLEAN NOT NULL DEFAULT false,
    "deck_check_started" BOOLEAN NOT NULL DEFAULT false,
    "deck_check_completed" BOOLEAN NOT NULL DEFAULT false,
    "assigned_judge" TEXT,
    "result_reported_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "p1_user_id" TEXT,
    "p1_name" TEXT,
    "p2_user_id" TEXT,
    "p2_name" TEXT,
    "winning_player_id" TEXT,
    "raw_payload" JSONB,

    CONSTRAINT "raw_carde_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_pf_drops" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "pf_tournament_id" TEXT NOT NULL,
    "player_game_id" TEXT NOT NULL,
    "round" INTEGER,
    "table_number" INTEGER,
    "player_name" TEXT,
    "is_checked" BOOLEAN NOT NULL DEFAULT false,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "raw_payload" JSONB,

    CONSTRAINT "raw_pf_drops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_pf_penalties" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "pf_tournament_id" TEXT NOT NULL,
    "pf_id" TEXT NOT NULL,
    "round" INTEGER,
    "player_game_id" TEXT,
    "player_name" TEXT,
    "description" TEXT,
    "infraction" TEXT,
    "sanction" TEXT,
    "created_at" TIMESTAMPTZ,
    "creator_id" TEXT,
    "creator_name" TEXT,
    "raw_payload" JSONB,

    CONSTRAINT "raw_pf_penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_pf_extensions" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "pf_tournament_id" TEXT NOT NULL,
    "table_number" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "from_minutes" INTEGER,
    "to_minutes" INTEGER,
    "user_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "raw_payload" JSONB,

    CONSTRAINT "raw_pf_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_pf_coverage" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "pf_tournament_id" TEXT NOT NULL,
    "table_number" INTEGER NOT NULL,
    "covered_by" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "raw_payload" JSONB,

    CONSTRAINT "raw_pf_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_pf_judge_calls" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "tournament_id" INTEGER NOT NULL,
    "pf_tournament_id" TEXT NOT NULL,
    "table_number" INTEGER NOT NULL,
    "round" INTEGER,
    "judge" TEXT,
    "judge_result" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ NOT NULL,
    "raw_payload" JSONB,

    CONSTRAINT "raw_pf_judge_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_pf_staff" (
    "id" SERIAL NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL,
    "pf_user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "raw_payload" JSONB,

    CONSTRAINT "raw_pf_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_source_mapping_tournament_id_source_key" ON "tournament_source_mapping"("tournament_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_username_key" ON "app_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "app_sessions_token_key" ON "app_sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_tournament_id_round_number_key" ON "rounds"("tournament_id", "round_number");

-- CreateIndex
CREATE UNIQUE INDEX "matches_tournament_id_round_number_table_number_key" ON "matches"("tournament_id", "round_number", "table_number");

-- CreateIndex
CREATE UNIQUE INDEX "drops_tournament_id_player_game_id_round_key" ON "drops"("tournament_id", "player_game_id", "round");

-- CreateIndex
CREATE UNIQUE INDEX "table_coverage_tournament_id_table_number_covered_by_key" ON "table_coverage"("tournament_id", "table_number", "covered_by");

-- CreateIndex
CREATE UNIQUE INDEX "pf_staff_pf_user_id_key" ON "pf_staff"("pf_user_id");

-- AddForeignKey
ALTER TABLE "tournament_source_mapping" ADD CONSTRAINT "tournament_source_mapping_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_username_fkey" FOREIGN KEY ("username") REFERENCES "app_users"("username") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_state" ADD CONSTRAINT "worker_state_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drops" ADD CONSTRAINT "drops_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_coverage" ADD CONSTRAINT "table_coverage_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_judge_calls" ADD CONSTRAINT "table_judge_calls_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_carde_rounds" ADD CONSTRAINT "raw_carde_rounds_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_carde_matches" ADD CONSTRAINT "raw_carde_matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_pf_drops" ADD CONSTRAINT "raw_pf_drops_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_pf_penalties" ADD CONSTRAINT "raw_pf_penalties_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_pf_extensions" ADD CONSTRAINT "raw_pf_extensions_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_pf_coverage" ADD CONSTRAINT "raw_pf_coverage_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_pf_judge_calls" ADD CONSTRAINT "raw_pf_judge_calls_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "app_tournaments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
