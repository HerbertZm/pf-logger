import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import { resolveDatabaseUrl } from './resolveDatabaseUrl';

// Prisma 7 requires an explicit driver adapter — the connection URL is no longer
// read from the schema. PrismaPg wraps the standard `pg` pool.
const { url, target } = resolveDatabaseUrl();

if (target === 'prod') {
    // Loud, unmissable warning — you are running locally against production data.
    console.warn('\n⚠️  Connected to PRODUCTION database (PROD_DATABASE_URL)\n');
}

const adapter = new PrismaPg({ connectionString: url });

// Single shared client — multiple instances exhaust the connection pool.
export const prisma = new PrismaClient({ adapter });
