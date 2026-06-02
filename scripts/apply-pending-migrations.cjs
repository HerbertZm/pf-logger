/**
 * Apply pending migrations without Prisma advisory lock (dev server may be running).
 * Marks rows in _prisma_migrations when each file succeeds.
 *
 * Usage: node scripts/apply-pending-migrations.cjs
 */
require('dotenv/config');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PENDING = [
    '20260602120000_add_operator_notes',
    '20260602140000_events_and_timezone',
    '20260602160000_app_config',
];

const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set');
        process.exit(1);
    }

    const client = new Client({ connectionString: url });
    await client.connect();

    try {
        for (const name of PENDING) {
            const applied = await client.query(
                `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`,
                [name],
            );
            if (applied.rowCount > 0) {
                console.log(`skip (already applied): ${name}`);
                continue;
            }

            const sqlPath = path.join(migrationsDir, name, 'migration.sql');
            const sql = fs.readFileSync(sqlPath, 'utf8');
            console.log(`applying: ${name}`);
            try {
                await client.query(sql);
            } catch (err) {
                const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
                if (code !== '42701' && code !== '42P07') {
                    throw err;
                }
                console.log(`  (schema already present, recording migration)`);
            }

            const id = crypto.randomUUID();
            await client.query(
                `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
                 VALUES ($1, '', NOW(), $2, NULL, NULL, NOW(), 1)`,
                [id, name],
            );
            console.log(`done: ${name}`);
        }
        console.log('All pending migrations applied.');
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
