-- CreateTable
CREATE TABLE "games" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "default_round_length_min" INTEGER NOT NULL,
    "notes" JSONB,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

INSERT INTO "games" ("name", "default_round_length_min", "notes") VALUES
    ('Magic: The Gathering', 50, NULL),
    ('Lorcana', 50, NULL),
    ('Riftbound', 50, NULL);

-- AlterTable
ALTER TABLE "app_tournaments" ADD COLUMN "game_id" INTEGER;

UPDATE "app_tournaments" SET "game_id" = 1 WHERE "game_id" IS NULL;

ALTER TABLE "app_tournaments" ALTER COLUMN "game_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "app_tournaments" ADD CONSTRAINT "app_tournaments_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
