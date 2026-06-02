CREATE TABLE "app_events" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "venue" TEXT,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "app_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "app_tournaments" ADD COLUMN "event_id" INTEGER;
ALTER TABLE "app_tournaments" ADD COLUMN "timezone" TEXT;
ALTER TABLE "app_tournaments" ADD COLUMN "venue" TEXT;

UPDATE "app_tournaments" SET "timezone" = 'America/New_York' WHERE "timezone" IS NULL;

ALTER TABLE "app_tournaments" ALTER COLUMN "timezone" SET NOT NULL;
ALTER TABLE "app_tournaments" ALTER COLUMN "timezone" SET DEFAULT 'America/New_York';

ALTER TABLE "app_tournaments" ADD CONSTRAINT "app_tournaments_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "app_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
