import { PrismaClient } from '@prisma/client';

// Single shared client — multiple instances exhaust the connection pool.
export const prisma = new PrismaClient();
