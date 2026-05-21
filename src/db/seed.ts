import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const PEPPER = process.env['PF_PASSWORD_PEPPER'] ?? '';

async function main(): Promise<void> {
  const hash = await bcrypt.hash('changeme' + PEPPER, 12);

  const user = await prisma.appUser.upsert({
    where: { username: 'admin' },
    create: { username: 'admin', passwordHash: hash, role: 'superadmin' },
    update: {},
  });

  console.warn(`Seeded: ${user.username} (${user.role}) — password: changeme — change this immediately`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
