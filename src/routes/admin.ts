import { Router, Request, Response, json as expressJson } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { requireSuperadmin, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { spawnTournamentWorker } from '../ingestion/worker';
import { importLegacy, type LegacyExport } from '../db/import-legacy';

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

  let user;
  try {
    user = await prisma.appUser.update({
      where: { id },
      data: { ...(role !== undefined && { role }), ...(isActive !== undefined && { isActive }) },
      select: { id: true, username: true, role: true, isActive: true },
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    throw err;
  }
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
  try {
    await prisma.appTournament.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    throw err;
  }
  res.json({ ok: true });
}));

// POST /api/admin/tournaments
// Body: { name, shortName, sources: [{ source: 'carde'|'purplefox', externalId }] }
router.post('/tournaments', asyncHandler(async (req: Request, res: Response) => {
  const { name, shortName, sources } = req.body as {
    name?: string;
    shortName?: string;
    sources?: Array<{ source: string; externalId: string }>;
  };

  if (!name || !shortName) {
    res.status(400).json({ error: 'name and shortName are required' });
    return;
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    res.status(400).json({ error: 'sources must be a non-empty array' });
    return;
  }

  const VALID_SOURCES = ['carde', 'purplefox'];
  for (const s of sources) {
    if (!VALID_SOURCES.includes(s.source)) {
      res.status(400).json({ error: `source must be one of: ${VALID_SOURCES.join(', ')}` });
      return;
    }
    if (!s.externalId) {
      res.status(400).json({ error: 'each source entry must have an externalId' });
      return;
    }
  }

  // Create tournament + source mappings + worker_state in a transaction
  const tournament = await prisma.$transaction(async (tx) => {
    const created = await tx.appTournament.create({
      data: { name, shortName },
    });

    await tx.tournamentSourceMapping.createMany({
      data: sources.map((s) => ({
        tournamentId: created.id,
        source: s.source,
        externalId: s.externalId,
      })),
    });

    await tx.workerState.create({
      data: { tournamentId: created.id, isRunning: false },
    });

    return tx.appTournament.findUniqueOrThrow({
      where: { id: created.id },
      include: { sourceMappings: true, workerState: true },
    });
  });

  // Kick off the polling worker (non-blocking — don't await, failures are logged internally)
  spawnTournamentWorker(tournament.id).catch((err) => {
    console.error(`[admin] failed to spawn worker for tournament ${tournament.id}:`, err);
  });

  res.status(201).json(tournament);
}));

// PATCH /api/admin/tournaments/:id/sources
// Body: { source: 'carde'|'purplefox', isEnabled?, externalId? }
router.patch('/tournaments/:id/sources', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!id) { res.status(400).json({ error: 'invalid id' }); return; }

  const { source, isEnabled, externalId } = req.body as {
    source?: string;
    isEnabled?: boolean;
    externalId?: string;
  };

  if (!source) {
    res.status(400).json({ error: 'source is required' });
    return;
  }
  if (isEnabled === undefined && externalId === undefined) {
    res.status(400).json({ error: 'at least one of isEnabled or externalId must be provided' });
    return;
  }

  // Verify tournament exists
  const tournament = await prisma.appTournament.findUnique({ where: { id } });
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }

  let mapping;
  try {
    mapping = await prisma.tournamentSourceMapping.update({
      where: { tournamentId_source: { tournamentId: id, source } },
      data: {
        ...(isEnabled !== undefined && { isEnabled }),
        ...(externalId !== undefined && { externalId }),
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: `No '${source}' source mapping for tournament ${id}` });
      return;
    }
    throw err;
  }

  res.json(mapping);
}));

// POST /api/admin/import
// Imports a legacy-export.json payload generated by src/db/export-legacy.ts.
// Accepts up to 10MB JSON body (legacy data can exceed the default 100kb limit).
// Idempotent — safe to re-run if interrupted.
router.post('/import', expressJson({ limit: '10mb' }), asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body as Partial<LegacyExport>;

  if (payload.version !== 1) {
    res.status(400).json({ error: 'Invalid or missing export payload. Expected { version: 1, ... }.' });
    return;
  }

  const result = await importLegacy(payload as LegacyExport);
  res.json(result);
}));

export { router as adminRouter };
