import { defineConfig } from 'prisma/config';
import 'dotenv/config';
import { resolveDatabaseUrl } from './src/db/resolveDatabaseUrl';

const { url } = resolveDatabaseUrl();

export default defineConfig({
    schema: 'src/db/schema.prisma',
    migrations: {
        path: 'src/db/migrations',
        seed: 'ts-node --compiler-options {"module":"CommonJS"} src/db/seed.ts',
    },
    datasource: {
        url,
    },
});
