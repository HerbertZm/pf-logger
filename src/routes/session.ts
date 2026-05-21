import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db/prisma';
import { loginRateLimit } from '../middleware/rateLimit';
import { authMiddleware, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { setPfJwt } from '../ingestion/jwtStore';

const router = Router();

const SESSION_TTL_DAYS = 30;
const PEPPER = process.env['PF_PASSWORD_PEPPER'] ?? '';

// POST /api/login
router.post('/login', loginRateLimit, asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  const user = await prisma.appUser.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password + PEPPER, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await prisma.appSession.create({
    data: {
      token,
      username,
      expiresAt,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    },
  });

  await prisma.appActivity.create({
    data: { eventType: 'login', username, ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null },
  });

  res.json({ token, username, role: user.role });
}));

// POST /api/logout
router.post('/logout', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const token = req.headers['authorization']?.slice(7);
  if (token) {
    await prisma.appSession.deleteMany({ where: { token } });
    const user = (req as AuthenticatedRequest).user;
    await prisma.appActivity.create({
      data: { eventType: 'logout', username: user.username, ip: req.ip ?? null },
    });
  }
  res.json({ ok: true });
}));

// GET /api/me
router.get('/me', authMiddleware, (req: Request, res: Response): void => {
  const user = (req as AuthenticatedRequest).user;
  res.json({ username: user.username, role: user.role });
});

// POST /api/set-token  (PF JWT paste — admin+ only; PF-source tournaments only)
router.post('/set-token', authMiddleware, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { jwt, tournamentId } = req.body as { jwt?: string; tournamentId?: number };
  if (!jwt || !tournamentId) {
    res.status(400).json({ error: 'jwt and tournamentId required' });
    return;
  }

  // Decode expiry from JWT payload (no verification — Supabase validates on use)
  let expiresAt: string | null = null;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64').toString()) as {
      exp?: number;
    };
    if (payload.exp) expiresAt = new Date(payload.exp * 1000).toISOString();
  } catch {
    // non-fatal — expiry display will just be null
  }

  // JWT is stored in memory only; never written to DB.
  // Only expiresAt is persisted so the UI can show the expiry warning across restarts.
  setPfJwt(tournamentId, jwt, expiresAt);

  await prisma.tournamentSourceMapping.updateMany({
    where: { tournamentId, source: 'purplefox' },
    data: { metadata: { expiresAt } },
  });

  res.json({ ok: true, expiresAt });
}));

export { router as sessionRouter };
