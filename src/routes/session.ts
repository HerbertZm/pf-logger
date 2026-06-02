import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db/prisma';
import { loginRateLimit } from '../middleware/rateLimit';
import { authMiddleware, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { setPfJwt, getPfJwtEntry, clearPfJwt, isPfJwtInMemory } from '../ingestion/jwtStore';
import { auditFromRequest, auditPublicRequest } from '../services/auditLog';

const router = Router();

const SESSION_TTL_DAYS = 30;
const PEPPER = process.env['PF_PASSWORD_PEPPER'] ?? '';

// POST /api/login
router.post(
    '/login',
    loginRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
        const { username, password } = req.body as { username?: string; password?: string };
        if (!username || !password) {
            res.status(400).json({ error: 'username and password required' });
            return;
        }

        const user = await prisma.appUser.findUnique({ where: { username } });
        if (!user?.isActive) {
            void auditPublicRequest(req, 'login_failed', username, 'inactive or unknown');
            res.status(401).json({ error: 'Invalid credentials' });
            return;
        }

        const valid = await bcrypt.compare(password + PEPPER, user.passwordHash);
        if (!valid) {
            void auditPublicRequest(req, 'login_failed', username, 'bad password');
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
            data: {
                eventType: 'login',
                username,
                ip: req.ip ?? null,
                userAgent: req.headers['user-agent'] ?? null,
            },
        });

        res.json({ token, username, role: user.role });
    }),
);

// POST /api/logout
router.post(
    '/logout',
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
        const token = req.headers['authorization']?.slice(7);
        if (token) {
            await prisma.appSession.deleteMany({ where: { token } });
            const user = (req as AuthenticatedRequest).user;
            await prisma.appActivity.create({
                data: { eventType: 'logout', username: user.username, ip: req.ip ?? null },
            });
        }
        res.json({ ok: true });
    }),
);

// GET /api/me
router.get('/me', authMiddleware, (req: Request, res: Response): void => {
    const user = (req as AuthenticatedRequest).user;
    res.json({ username: user.username, role: user.role });
});

// POST /api/session/pf-jwt  — paste PF JWT (admin+)
router.post(
    '/session/pf-jwt',
    authMiddleware,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const { jwt } = req.body as { jwt?: string };
        if (!jwt) {
            res.status(400).json({ error: 'jwt required' });
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
            // non-fatal — expiry display will be null
        }

        const user = (req as AuthenticatedRequest).user;

        // JWT stored in memory only — never written to DB
        setPfJwt(jwt, expiresAt, user.username);

        // Persist only metadata to pf_session (singleton id=1)
        await prisma.$executeRaw`
    INSERT INTO pf_session (id, set_by, set_at, expires_at)
    VALUES (1, ${user.username}, NOW(), ${expiresAt}::timestamptz)
    ON CONFLICT (id) DO UPDATE SET
      set_by = EXCLUDED.set_by,
      set_at = EXCLUDED.set_at,
      expires_at = EXCLUDED.expires_at
  `;

        void auditFromRequest(req, 'pf_jwt_set', `expiresAt=${expiresAt ?? 'unknown'}`);

        res.json({ ok: true, expiresAt });
    }),
);

// GET /api/session/pf-jwt — JWT status (never returns token)
router.get(
    '/session/pf-jwt',
    authMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
        const inMemory = isPfJwtInMemory();
        const memEntry = getPfJwtEntry();

        // If not in memory, fall back to DB metadata so UI knows when it last expired
        if (!inMemory) {
            const rows = await prisma.$queryRaw<{ set_by: string; set_at: Date; expires_at: Date | null }[]>`
      SELECT set_by, set_at, expires_at FROM pf_session WHERE id = 1
    `;
            const row = rows[0] ?? null;
            const expired = row?.expires_at ? row.expires_at < new Date() : true;
            res.json({
                status: row ? (expired ? 'expired' : 'valid') : 'missing',
                expiresAt: row?.expires_at?.toISOString() ?? null,
                setBy: row?.set_by ?? null,
                inMemory: false,
            });
            return;
        }

        const expired = memEntry?.expiresAt ? new Date(memEntry.expiresAt) < new Date() : false;
        res.json({
            status: expired ? 'expired' : 'valid',
            expiresAt: memEntry?.expiresAt ?? null,
            setBy: memEntry?.setBy ?? null,
            inMemory: true,
        });
    }),
);

// DELETE /api/session/pf-jwt — clear stored JWT (admin+)
router.delete(
    '/session/pf-jwt',
    authMiddleware,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        clearPfJwt();
        // Null out the pf_session metadata row so a subsequent GET (or restart) returns
        // status: 'missing' rather than showing the previous token's expiry.
        await prisma.$executeRaw`
    UPDATE pf_session SET expires_at = NULL, set_by = NULL, set_at = NULL WHERE id = 1
  `;
        void auditFromRequest(req, 'pf_jwt_cleared', null);
        res.json({ ok: true });
    }),
);

export { router as sessionRouter };
