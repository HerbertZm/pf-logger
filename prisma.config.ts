import { defineConfig } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
  schema: 'src/db/schema.prisma',
  migrate: {
    // Connection URL for Prisma Migrate (prisma migrate dev/deploy)
    url: process.env['DATABASE_URL'] ?? '',
  },
});
