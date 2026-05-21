import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { requireSuperadmin, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const PEPPER = process.env['PF_PASSWORD_PEPPER'] ?? '';

const VALID_ROLES = ['user', 'admin', 'superadmin'] as const;

// All admin routes require superadmin — apply guard globally here
router.use(requireSuperadmin);

// GET /api/admin/users
router.get('/users', asyncHandler(async (_req: Request, res: Response) => {
  const users = await prisma.appUser.findMany({
    select: { id: true, username: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(users);
}));

// POST /api/admin/users
router.post('/users', asyncHandler(async (req: Request, res: Response) => {
  const { username, password, role } = req.body as {
    username?: string;
    password?: string;
    role?: string;
  };
  if (!username || !password || !role) {
    res.status(400).json({ error: 'username, password, and role required' });
    return;
  }
  if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }
  const passwordHash = await bcrypt.hash(password + PEPPER, 12);
  const user = await prisma.appUser.create({
    data: { username, passwordHash, role },
    select: { id: true, username: true, role: true, isActive: true, createdAt: true },
  });
  res.status(201).json(user);
}));

// PATCH /api/admin/users/:id
router.patch('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!id) { res.status(400).json({ error: 'invalid id' }); return; }

  const requester = (req as AuthenticatedRequest).user;
  const { role, isActive } = req.body as { role?: string; isActive?: boolean };

  if (role !== undefined && !VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
    res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }

  // Cannot deactivate yourself
  if (requester.id === id && isActive === false) {
    res.status(400).json({ error: 'Cannot deactivate your own account' });
    return;
  }

  const user = await prisma.appUser.update({
    where: { id },
    data: { ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
    select: { id: true, username: true, role: true, isActive: true },
  });
  res.json(user);
}));

// GET /api/admin/sessions
router.get('/sessions', asyncHandler(async (_req: Request, res: Response) => {
  const sessions = await prisma.appSession.findMany({
    select: { id: true, username: true, createdAt: true, expiresAt: true, ip: true, userAgent: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json(sessions);
}));

// DELETE /api/admin/sessions/:id
router.delete('/sessions/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!id) { res.status(400).json({ error: 'invalid id' }); return; }
  try {
    await prisma.appSession.delete({ where: { id } });
  } catch {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ ok: true });
}));

// GET /api/admin/tournaments  (includes soft-deleted, for admin view)
router.get('/tournaments', asyncHandler(async (_req: Request, res: Response) => {
  const tournaments = await prisma.appTournament.findMany({
    include: { sourceMappings: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(tournaments);
}));

// DELETE /api/admin/tournaments/:id  (soft-delete)
router.delete('/tournaments/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!id) { res.status(400).json({ error: 'invalid id' }); return; }
  await prisma.appTournament.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  res.json({ ok: true });
}));

// POST /api/admin/tournaments
router.post('/tournaments', (_req: Request, res: Response): void => {
  // TODO: P1 — create tournament + source mappings
  res.status(501).json({ error: 'Not implemented' });
});

// PATCH /api/admin/tournaments/:id/sources
router.patch('/tournaments/:id/sources', (_req: Request, res: Response): void => {
  // TODO: P1 — toggle is_enabled on source mapping rows
  res.status(501).json({ error: 'Not implemented' });
});

export { router as adminRouter };
