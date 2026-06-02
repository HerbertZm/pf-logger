import { defineConfig, env } from 'prisma/config';
import 'dotenv/config';

export default defineConfig({
    schema: 'src/db/schema.prisma',
    migrations: {
        path: 'src/db/migrations',
        seed: 'ts-node --compiler-options {"module":"CommonJS"} src/db/seed.ts',
    },
    datasource: {
        url: env('DATABASE_URL'),
    },
});
