/**
 * Apply Prisma SQL migrations without the advisory lock (safe while npm run dev is up).
 * Discovers every migration folder under src/db/migrations (each with migration.sql),
 * _prisma_migrations, and records them the same way migrate deploy would.
 *
 * Usage:
 *   npm run db:apply-pending
 *   node scripts/apply-pending-migrations.cjs [--dry-run]
 */
require('dotenv/config');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
const dryRun = process.argv.includes('--dry-run');

function listMigrationNames() {
    return fs
        .readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => fs.existsSync(path.join(migrationsDir, name, 'migration.sql')))
        .sort();
}

function checksumForSql(sql) {
    return crypto.createHash('sha256').update(sql).digest('hex');
}

async function isApplied(client, name) {
    const result = await client.query(
        `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL LIMIT 1`,
        [name],
    );
    return result.rowCount > 0;
}

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set');
        process.exit(1);
    }

    const names = listMigrationNames();
    if (names.length === 0) {
        console.error(`No migrations found under ${migrationsDir}`);
        process.exit(1);
    }

    const client = new Client({ connectionString: url });
    await client.connect();

    try {
        let appliedCount = 0;
        let skippedCount = 0;

        for (const name of names) {
            if (await isApplied(client, name)) {
                skippedCount++;
                continue;
            }

            const sqlPath = path.join(migrationsDir, name, 'migration.sql');
            const sql = fs.readFileSync(sqlPath, 'utf8');

            if (dryRun) {
                console.log(`would apply: ${name}`);
                appliedCount++;
                continue;
            }

            console.log(`applying: ${name}`);
            try {
                await client.query(sql);
            } catch (err) {
                const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
                // Already applied outside Prisma (manual SQL, partial run)
                if (code !== '42701' && code !== '42P07') {
                    throw err;
                }
                console.log(`  (schema already present, recording migration)`);
            }

            const id = crypto.randomUUID();
            const checksum = checksumForSql(sql);
            await client.query(
                `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
                 VALUES ($1, $2, NOW(), $3, NULL, NULL, NOW(), 1)`,
                [id, checksum, name],
            );
            console.log(`done: ${name}`);
            appliedCount++;
        }

        if (dryRun) {
            console.log(`Dry run: ${appliedCount} migration(s) would be applied, ${skippedCount} already recorded.`);
        } else if (appliedCount === 0) {
            console.log(`No pending migrations (${skippedCount} already applied).`);
        } else {
            console.log(`Applied ${appliedCount} migration(s); ${skippedCount} already up to date.`);
        }
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
