CREATE TABLE "app_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "carde_poll_interval_ms" INTEGER NOT NULL DEFAULT 30000,
    "pf_poll_interval_ms" INTEGER NOT NULL DEFAULT 15000,
    "extension_logistics_threshold_min" INTEGER NOT NULL DEFAULT 50,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "app_config" ("id") VALUES (1) ON CONFLICT DO NOTHING;
