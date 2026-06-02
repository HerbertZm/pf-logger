import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

// Prisma 7 requires an explicit driver adapter — the connection URL is no longer
// read from the schema. PrismaPg wraps the standard `pg` pool.
const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });

// Single shared client — multiple instances exhaust the connection pool.
export const prisma = new PrismaClient({ adapter });
