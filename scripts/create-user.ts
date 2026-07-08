/**
 * Create (or update) an app user.
 *
 * Usage:
 *   ts-node --compiler-options '{"module":"CommonJS"}' scripts/create-user.ts <username> <password> [role]
 *   role defaults to 'user'; valid: user | admin | superadmin
 *   Set USE_PROD_DB=true to target the production DB.
 *
 * Password is peppered (PF_PASSWORD_PEPPER) then bcrypt-hashed, matching login.
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { prisma } from '../src/db/prisma';

const PEPPER = process.env['PF_PASSWORD_PEPPER'] ?? '';
const VALID_ROLES = ['user', 'admin', 'superadmin'];

async function main(): Promise<void> {
    const [username, password, role = 'user'] = process.argv.slice(2);
    if (!username || !password) {
        console.error('Usage: create-user.ts <username> <password> [role]');
        process.exit(1);
    }
    if (!VALID_ROLES.includes(role)) {
        console.error(`Invalid role "${role}". Valid: ${VALID_ROLES.join(', ')}`);
        process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password + PEPPER, 12);
    const target = process.env['USE_PROD_DB'] === 'true' ? 'PROD' : 'local';

    const user = await prisma.appUser.upsert({
        where: { username },
        create: { username, passwordHash, role, isActive: true },
        update: { passwordHash, role, isActive: true },
    });

    console.warn(`[${target}] Upserted user "${user.username}" (role: ${user.role}, active: ${user.isActive})`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
