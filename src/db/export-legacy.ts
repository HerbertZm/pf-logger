/**
 * P0.6 — Step 1: Export local SQLite data to a JSON file.
 *
 * Run from the project root where action_logs.db lives:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' src/db/export-legacy.ts
 *
 * Output: legacy-export.json  (gitignored)
 * Next step: POST that file to POST /api/admin/import on the server.
 *   curl -X POST https://<host>/api/admin/import \
 *        -H "Authorization: Bearer <token>" \
 *        -H "Content-Type: application/json" \
 *        -d @legacy-export.json
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function main(): void {
  const dbPath = path.resolve(process.cwd(), 'action_logs.db');

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: DB not found at ${dbPath}`);
    console.error('Run this script from the project root where action_logs.db lives.');
    process.exit(1);
  }

  console.log(`Reading: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  // Verify all expected tables exist
  const tables = (db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table'`,
  ).all() as { name: string }[]).map((r) => r.name);

  const required = ['tournament_meta', 'round_timers', 'drops', 'penalties', 'time_logs'];
  const optional = ['table_coverage', 'table_judge_results', 'users'];
  const missing = required.filter((t) => !tables.includes(t));
  if (missing.length > 0) {
    console.error(`Error: missing required tables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const payload = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    tournaments:  db.prepare('SELECT * FROM tournament_meta').all(),
    rounds:       db.prepare('SELECT * FROM round_timers ORDER BY tournament_id, round').all(),
    drops:        db.prepare('SELECT * FROM drops').all(),
    penalties:    db.prepare('SELECT * FROM penalties').all(),
    timeLogs:     db.prepare('SELECT * FROM time_logs ORDER BY created_at').all(),
    coverage:     tables.includes('table_coverage')
      ? db.prepare('SELECT * FROM table_coverage').all()
      : [],
    judgeResults: tables.includes('table_judge_results')
      ? db.prepare('SELECT * FROM table_judge_results').all()
      : [],
    users:        tables.includes('users')
      ? db.prepare('SELECT * FROM users').all()
      : [],
  };

  db.close();

  const outPath = path.resolve(process.cwd(), 'legacy-export.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`\nExported to: ${outPath}`);
  console.log(`  tournaments:   ${(payload.tournaments as unknown[]).length}`);
  console.log(`  rounds:        ${(payload.rounds as unknown[]).length}`);
  console.log(`  drops:         ${(payload.drops as unknown[]).length}`);
  console.log(`  penalties:     ${(payload.penalties as unknown[]).length}`);
  console.log(`  time_logs:     ${(payload.timeLogs as unknown[]).length}`);
  console.log(`  coverage:      ${(payload.coverage as unknown[]).length}`);
  console.log(`  judge_results: ${(payload.judgeResults as unknown[]).length}`);
  console.log(`  users:         ${(payload.users as unknown[]).length}`);
  console.log(`\nNext: POST legacy-export.json to /api/admin/import`);
}

main();
