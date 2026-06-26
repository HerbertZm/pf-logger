import 'dotenv/config';

export type DbTarget = 'local' | 'prod';

/**
 * Selects which database the app/CLI connects to.
 *
 * Default is the local DB (`DATABASE_URL`). Set `USE_PROD_DB=true` (or
 * `DB_TARGET=prod`) to point at the production DB (`PROD_DATABASE_URL`) — used
 * by the `:prod` npm scripts so you can run the app locally against prod data.
 */
export function resolveDatabaseUrl(): { url: string; target: DbTarget } {
    const useProd =
        process.env['USE_PROD_DB'] === 'true' || process.env['DB_TARGET'] === 'prod';

    if (useProd) {
        const url = process.env['PROD_DATABASE_URL'];
        if (!url) {
            throw new Error(
                'USE_PROD_DB is set but PROD_DATABASE_URL is empty — add it to .env',
            );
        }
        return { url, target: 'prod' };
    }

    return { url: process.env['DATABASE_URL'] ?? '', target: 'local' };
}
