import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../db/prisma';
import { requireSuperadmin, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { spawnTournamentWorker, stopTournamentWorker, syncPfStaff } from '../ingestion/worker';
import { serializeAdminTournament, serializeAppEvent, serializeTournament } from './serializers';
import type { AppEventSummary } from '../api/eventTypes';
import { DEFAULT_TIMEZONE, isValidIanaTimezone } from '../utils/timezone';
import { seedTestTournament } from '../db/seed-test-tournament';
import { getAppConfig, updateAppConfig, type AppConfigValues } from '../services/appConfig';
import { buildHealthStatus } from '../services/healthStatus';
import { auditFromRequest } from '../services/auditLog';
import {
    validateUsername,
    validatePassword,
    validateSourceExternalId,
} from '../utils/validation';

function fireAudit(req: Request, eventType: Parameters<typeof auditFromRequest>[1], detail?: string): void {
    void auditFromRequest(req, eventType, detail ?? null).catch(() => undefined);
}

const router = Router();
const PEPPER = process.env['PF_PASSWORD_PEPPER'] ?? '';

const VALID_ROLES = ['user', 'admin', 'superadmin'] as const;

// All admin routes require superadmin — apply guard globally here
router.use(requireSuperadmin);

const MAX_VENUE_LEN = 256;

function parseTimezone(tz: string | undefined, res: Response): string | null {
    if (tz === undefined || tz.trim().length === 0) {
        res.status(400).json({ error: 'timezone is required' });
        return null;
    }
    const trimmed = tz.trim();
    if (!isValidIanaTimezone(trimmed)) {
        res.status(400).json({ error: 'invalid IANA timezone' });
        return null;
    }
    return trimmed;
}

// GET /api/admin/events
router.get(
    '/events',
    asyncHandler(async (_req: Request, res: Response) => {
        const events = await prisma.appEvent.findMany({
            include: { _count: { select: { tournaments: true } } },
            orderBy: { name: 'asc' },
        });
        const body: AppEventSummary[] = events.map(serializeAppEvent);
        res.json(body);
    }),
);

// POST /api/admin/events
router.post(
    '/events',
    asyncHandler(async (req: Request, res: Response) => {
        const { name, shortName, timezone, venue } = req.body as {
            name?: string;
            shortName?: string;
            timezone?: string;
            venue?: string | null;
        };
        if (!name?.trim() || !shortName?.trim()) {
            res.status(400).json({ error: 'name and shortName are required' });
            return;
        }
        const tz = parseTimezone(timezone, res);
        if (tz === null) return;
        if (venue !== undefined && venue !== null && venue.length > MAX_VENUE_LEN) {
            res.status(400).json({ error: `venue must be at most ${MAX_VENUE_LEN} characters` });
            return;
        }
        const event = await prisma.appEvent.create({
            data: {
                name: name.trim(),
                shortName: shortName.trim(),
                timezone: tz,
                venue: (() => {
                    const v = venue?.trim();
                    return v === undefined || v === '' ? null : v;
                })(),
            },
            include: { _count: { select: { tournaments: true } } },
        });
        fireAudit(req, 'event_created', event.name);
        res.status(201).json(serializeAppEvent(event));
    }),
);

// PATCH /api/admin/events/:id
router.patch(
    '/events/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }
        const { name, shortName, timezone, venue, isActive, applyTimezoneToTournaments } = req.body as {
            name?: string;
            shortName?: string;
            timezone?: string;
            venue?: string | null;
            isActive?: boolean;
            applyTimezoneToTournaments?: boolean;
        };
        if (name?.trim() === '') {
            res.status(400).json({ error: 'name cannot be empty' });
            return;
        }
        if (shortName?.trim() === '') {
            res.status(400).json({ error: 'shortName cannot be empty' });
            return;
        }
        let tz: string | undefined;
        if (timezone !== undefined) {
            const parsed = parseTimezone(timezone, res);
            if (parsed === null) return;
            tz = parsed;
        }
        if (venue !== undefined && venue !== null && venue.length > MAX_VENUE_LEN) {
            res.status(400).json({ error: `venue must be at most ${MAX_VENUE_LEN} characters` });
            return;
        }

        const event = await prisma.$transaction(async (tx) => {
            const updated = await tx.appEvent.update({
                where: { id },
                data: {
                    ...(name !== undefined && { name: name.trim() }),
                    ...(shortName !== undefined && { shortName: shortName.trim() }),
                    ...(tz !== undefined && { timezone: tz }),
                    ...(venue !== undefined && { venue: venue === null ? null : venue.trim() || null }),
                    ...(isActive !== undefined && { isActive }),
                },
                include: { _count: { select: { tournaments: true } } },
            });
            if (applyTimezoneToTournaments === true && tz !== undefined) {
                await tx.appTournament.updateMany({
                    where: { eventId: id },
                    data: { timezone: tz },
                });
            }
            return updated;
        });

        if (applyTimezoneToTournaments === true && tz !== undefined) {
            fireAudit(req, 'event_timezone_cascaded', `eventId=${id}`);
        } else {
            fireAudit(req, 'event_updated', `id=${id}`);
        }
        res.json(serializeAppEvent(event));
    }),
);

// DELETE /api/admin/events/:id — deactivate; blocked if active tournaments are linked
router.delete(
    '/events/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }
        const activeCount = await prisma.appTournament.count({
            where: { eventId: id, isActive: true, deletedAt: null },
        });
        if (activeCount > 0) {
            res.status(400).json({ error: 'Cannot deactivate event with active tournaments' });
            return;
        }
        const event = await prisma.appEvent.update({
            where: { id },
            data: { isActive: false },
            include: { _count: { select: { tournaments: true } } },
        });
        fireAudit(req, 'event_deactivated', `id=${id}`);
        res.json(serializeAppEvent(event));
    }),
);

// POST /api/admin/reset-test-tournament — local/dev only
router.post(
    '/reset-test-tournament',
    asyncHandler(async (req: Request, res: Response) => {
        if (process.env['NODE_ENV'] === 'production') {
            res.status(403).json({ error: 'Not available in production' });
            return;
        }
        const { scenario } = req.body as { scenario?: string };
        const allowed = new Set(['default', 'late', 'overtime', 'top8']);
        const picked = scenario && allowed.has(scenario) ? scenario : 'default';
        const id = await seedTestTournament(picked as 'default' | 'late' | 'overtime' | 'top8');
        fireAudit(req, 'test_tournament_reset', `tournamentId=${id} scenario=${picked}`);
        res.json({ ok: true, tournamentId: id, scenario: picked });
    }),
);

// GET /api/admin/health — full ops status (superadmin checklist)
router.get(
    '/health',
    asyncHandler(async (_req: Request, res: Response) => {
        const status = await buildHealthStatus(Math.floor(process.uptime()));
        res.status(status.ok ? 200 : 503).json(status);
    }),
);

// GET /api/admin/config
router.get('/config', (_req: Request, res: Response) => {
    res.json(getAppConfig());
});

// PATCH /api/admin/config
router.patch(
    '/config',
    asyncHandler(async (req: Request, res: Response) => {
        const body = req.body as Partial<AppConfigValues>;
        try {
            const updated = await updateAppConfig(body);
            fireAudit(req, 'config_updated', JSON.stringify(updated));
            res.json({
                ...updated,
                note: 'Poll intervals updated for all running tournament workers.',
            });
        } catch (err: unknown) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid config' });
        }
    }),
);

// GET /api/admin/activity — recent audit log (Manage → Activity)
router.get(
    '/activity',
    asyncHandler(async (_req: Request, res: Response) => {
        const rows = await prisma.appActivity.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json(rows);
    }),
);

// GET /api/admin/users
router.get(
    '/users',
    asyncHandler(async (_req: Request, res: Response) => {
        const users = await prisma.appUser.findMany({
            select: { id: true, username: true, role: true, isActive: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
        const lastSessions = await prisma.appSession.groupBy({
            by: ['username'],
            _max: { createdAt: true },
        });
        const lastLoginByUser = new Map(lastSessions.map((s) => [s.username, s._max.createdAt]));
        res.json(
            users.map((u) => ({
                ...u,
                createdAt: u.createdAt.toISOString(),
                lastLoginAt: lastLoginByUser.get(u.username)?.toISOString() ?? null,
            })),
        );
    }),
);

// POST /api/admin/users
router.post(
    '/users',
    asyncHandler(async (req: Request, res: Response) => {
        const { username, password, role } = req.body as {
            username?: string;
            password?: string;
            role?: string;
        };
        if (!username || !password || !role) {
            res.status(400).json({ error: 'username, password, and role required' });
            return;
        }
        if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
            res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
            return;
        }
        const usernameErr = validateUsername(username);
        if (usernameErr !== null) {
            res.status(400).json({ error: usernameErr });
            return;
        }
        const passwordErr = validatePassword(password);
        if (passwordErr !== null) {
            res.status(400).json({ error: passwordErr });
            return;
        }
        const passwordHash = await bcrypt.hash(password + PEPPER, 12);
        const user = await prisma.appUser.create({
            data: { username, passwordHash, role },
            select: { id: true, username: true, role: true, isActive: true, createdAt: true },
        });
        fireAudit(req, 'user_created', username);
        res.status(201).json({
            ...user,
            createdAt: user.createdAt.toISOString(),
            lastLoginAt: null,
        });
    }),
);

// PATCH /api/admin/users/:id
router.patch(
    '/users/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }

        const requester = (req as AuthenticatedRequest).user;
        const { role, isActive, password } = req.body as { role?: string; isActive?: boolean; password?: string };

        if (password !== undefined) {
            const passwordErr = validatePassword(password);
            if (passwordErr !== null) {
                res.status(400).json({ error: passwordErr });
                return;
            }
        }

        if (role !== undefined && !VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
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
            user = await prisma.$transaction(async (tx) => {
                const passwordHash =
                    password !== undefined ? await bcrypt.hash(password + PEPPER, 12) : undefined;
                const updated = await tx.appUser.update({
                    where: { id },
                    data: {
                        ...(role !== undefined && { role }),
                        ...(isActive !== undefined && { isActive }),
                        ...(passwordHash !== undefined && { passwordHash }),
                    },
                    select: { id: true, username: true, role: true, isActive: true },
                });
                if (isActive === false) {
                    await tx.appSession.deleteMany({ where: { username: updated.username } });
                }
                return updated;
            });
        } catch (err: unknown) {
            if ((err as { code?: string }).code === 'P2025') {
                res.status(404).json({ error: 'User not found' });
                return;
            }
            throw err;
        }
        if (password !== undefined) {
            fireAudit(req, 'user_password_reset', `id=${id}`);
        } else if (isActive === false) {
            fireAudit(req, 'user_deactivated', `id=${id}`);
        } else {
            fireAudit(req, 'user_updated', `id=${id}`);
        }
        const lastSession = await prisma.appSession.findFirst({
            where: { username: user.username },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });
        res.json({
            ...user,
            lastLoginAt: lastSession?.createdAt.toISOString() ?? null,
        });
    }),
);

// GET /api/admin/sessions
router.get(
    '/sessions',
    asyncHandler(async (_req: Request, res: Response) => {
        const sessions = await prisma.appSession.findMany({
            select: {
                id: true,
                username: true,
                createdAt: true,
                expiresAt: true,
                ip: true,
                userAgent: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json(sessions);
    }),
);

// DELETE /api/admin/sessions/:id
router.delete(
    '/sessions/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }
        try {
            await prisma.appSession.delete({ where: { id } });
        } catch {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        fireAudit(req, 'session_revoked', `sessionId=${id}`);
        res.json({ ok: true });
    }),
);

// GET /api/admin/tournaments  (includes soft-deleted, for admin view)
router.get(
    '/tournaments',
    asyncHandler(async (_req: Request, res: Response) => {
        const tournaments = await prisma.appTournament.findMany({
            include: { sourceMappings: true, game: true, event: true },
            orderBy: { createdAt: 'desc' },
        });
        const body = tournaments.map(serializeAdminTournament);
        res.json(body);
    }),
);

// DELETE /api/admin/tournaments/:id  (soft-delete)
router.delete(
    '/tournaments/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }
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
        stopTournamentWorker(id);
        fireAudit(req, 'tournament_deactivated', `id=${id}`);
        res.json({ ok: true });
    }),
);

// PATCH /api/admin/tournaments/:id
router.patch(
    '/tournaments/:id',
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }

        const { name, shortName, gameId, isActive, isEnded, eventId, timezone, venue, applyEventTimezone } =
            req.body as {
                name?: string;
                shortName?: string;
                gameId?: number;
                isActive?: boolean;
                isEnded?: boolean;
                eventId?: number | null;
                timezone?: string;
                venue?: string | null;
                applyEventTimezone?: boolean;
            };

        if (name !== undefined && (name.trim().length === 0 || name.length > 128)) {
            res.status(400).json({ error: 'name must be 1–128 characters' });
            return;
        }
        if (shortName !== undefined && (shortName.trim().length === 0 || shortName.length > 128)) {
            res.status(400).json({ error: 'shortName must be 1–128 characters' });
            return;
        }
        if (gameId !== undefined) {
            const game = await prisma.game.findUnique({ where: { id: Number(gameId) } });
            if (game === null) {
                res.status(404).json({ error: 'game not found' });
                return;
            }
        }
        if (venue !== undefined && venue !== null && venue.length > MAX_VENUE_LEN) {
            res.status(400).json({ error: `venue must be at most ${MAX_VENUE_LEN} characters` });
            return;
        }

        const existing = await prisma.appTournament.findUnique({ where: { id } });
        if (!existing) {
            res.status(404).json({ error: 'Tournament not found' });
            return;
        }

        const wasRunning =
            existing.isActive &&
            !existing.isEnded &&
            existing.deletedAt === null &&
            !existing.isTestTournament;

        const data: {
            name?: string;
            shortName?: string;
            gameId?: number;
            isActive?: boolean;
            isEnded?: boolean;
            deletedAt?: Date | null;
            eventId?: number | null;
            timezone?: string;
            venue?: string | null;
        } = {
            ...(name !== undefined && { name: name.trim() }),
            ...(shortName !== undefined && { shortName: shortName.trim() }),
            ...(gameId !== undefined && { gameId: Number(gameId) }),
            ...(isActive !== undefined && { isActive }),
            ...(isEnded !== undefined && { isEnded }),
            ...(isActive === true && { deletedAt: null }),
            ...(venue !== undefined && { venue: venue === null ? null : venue.trim() || null }),
        };

        if (eventId !== undefined) {
            if (eventId === null) {
                data.eventId = null;
            } else {
                const event = await prisma.appEvent.findUnique({ where: { id: eventId } });
                if (event === null) {
                    res.status(404).json({ error: 'event not found' });
                    return;
                }
                data.eventId = eventId;
                if (applyEventTimezone === true || timezone === undefined) {
                    data.timezone = event.timezone;
                    if (venue === undefined && event.venue) {
                        data.venue = event.venue;
                    }
                }
            }
        }

        if (timezone !== undefined) {
            const tz = parseTimezone(timezone, res);
            if (tz === null) return;
            data.timezone = tz;
        }

        let tournament;
        try {
            tournament = await prisma.appTournament.update({
                where: { id },
                data,
                include: { sourceMappings: true, game: true, event: true },
            });
        } catch (err: unknown) {
            if ((err as { code?: string }).code === 'P2025') {
                res.status(404).json({ error: 'Tournament not found' });
                return;
            }
            throw err;
        }

        const isRunning =
            tournament.isActive &&
            !tournament.isEnded &&
            tournament.deletedAt === null &&
            !tournament.isTestTournament;

        if (wasRunning && !isRunning) {
            stopTournamentWorker(id);
        } else if (!wasRunning && isRunning) {
            spawnTournamentWorker(id).catch(() => undefined);
        }

        const auditEvent = !wasRunning && isRunning ? 'tournament_reactivated' : 'tournament_updated';
        fireAudit(req, auditEvent, `id=${id}`);
        res.json(serializeAdminTournament(tournament));
    }),
);

// POST /api/admin/tournaments
// Body: { name, shortName, gameId, sources: [{ source: 'carde'|'purplefox', externalId }] }
router.post(
    '/tournaments',
    asyncHandler(async (req: Request, res: Response) => {
        const { name, shortName, gameId, sources, isTestTournament, eventId, timezone, venue, timezoneOverride } =
            req.body as {
                name?: string;
                shortName?: string;
                gameId?: number;
                sources?: Array<{ source: string; externalId: string }>;
                isTestTournament?: boolean;
                eventId?: number;
                timezone?: string;
                venue?: string | null;
                timezoneOverride?: boolean;
            };

        if (isTestTournament !== undefined) {
            res.status(400).json({ error: 'isTestTournament cannot be set via API — use db:seed-test locally' });
            return;
        }

        if (!name || !shortName) {
            res.status(400).json({ error: 'name and shortName are required' });
            return;
        }
        if (gameId === undefined || gameId === null || Number.isNaN(Number(gameId))) {
            res.status(400).json({ error: 'gameId is required' });
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
            const extErr = validateSourceExternalId(s.source, s.externalId);
            if (extErr !== null) {
                res.status(400).json({ error: extErr });
                return;
            }
        }

        const game = await prisma.game.findUnique({ where: { id: Number(gameId) } });
        if (game === null) {
            res.status(404).json({ error: 'game not found' });
            return;
        }
        if (venue !== undefined && venue !== null && venue.length > MAX_VENUE_LEN) {
            res.status(400).json({ error: `venue must be at most ${MAX_VENUE_LEN} characters` });
            return;
        }

        let resolvedTimezone: string;
        let resolvedEventId: number | null = null;
        const venueTrimmed = venue?.trim();
        let resolvedVenue: string | null = venueTrimmed === undefined || venueTrimmed === '' ? null : venueTrimmed;

        if (eventId !== undefined && eventId !== null) {
            const event = await prisma.appEvent.findUnique({ where: { id: Number(eventId) } });
            if (event === null) {
                res.status(404).json({ error: 'event not found' });
                return;
            }
            resolvedEventId = event.id;
            if (timezoneOverride === true && timezone !== undefined) {
                const tz = parseTimezone(timezone, res);
                if (tz === null) return;
                resolvedTimezone = tz;
            } else {
                resolvedTimezone = event.timezone;
            }
            if (!resolvedVenue && event.venue) {
                resolvedVenue = event.venue;
            }
        } else {
            const tz = parseTimezone(timezone ?? DEFAULT_TIMEZONE, res);
            if (tz === null) return;
            resolvedTimezone = tz;
        }

        // Create tournament + source mappings + worker_state in a transaction
        const tournament = await prisma.$transaction(async (tx) => {
            const created = await tx.appTournament.create({
                data: {
                    name,
                    shortName,
                    gameId: game.id,
                    eventId: resolvedEventId,
                    timezone: resolvedTimezone,
                    venue: resolvedVenue,
                },
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
                include: { sourceMappings: true, workerState: true, game: true, event: true },
            });
        });

        // Kick off the polling worker (non-blocking — don't await, failures are logged internally)
        spawnTournamentWorker(tournament.id).catch(() => undefined);

        fireAudit(req, 'tournament_created', `id=${tournament.id} name=${tournament.name}`);
        res.status(201).json(serializeTournament(tournament));
    }),
);

// PATCH /api/admin/tournaments/:id/sources
// Body: { source: 'carde'|'purplefox', isEnabled?, externalId? }
router.patch(
    '/tournaments/:id/sources',
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }

        const { source, isEnabled, externalId } = req.body as {
            source?: string;
            isEnabled?: boolean;
            externalId?: string;
        };

        if (!source) {
            res.status(400).json({ error: 'source is required' });
            return;
        }
        if (source !== 'carde' && source !== 'purplefox') {
            res.status(400).json({ error: 'source must be carde or purplefox' });
            return;
        }
        if (externalId !== undefined) {
            const extErr = validateSourceExternalId(source, externalId);
            if (extErr !== null) {
                res.status(400).json({ error: extErr });
                return;
            }
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

        fireAudit(req, 'source_toggled', `tournamentId=${id} source=${source}`);
        res.json(mapping);
    }),
);

// POST /api/admin/staff-sync
// Fetch all PF staff profiles and upsert into pf_staff.
// Requires a PF JWT to be in memory (set via Session panel first).
router.post(
    '/staff-sync',
    asyncHandler(async (req: Request, res: Response) => {
        const result = await syncPfStaff();
        fireAudit(req, 'staff_sync', `upserted=${result.upserted}`);
        res.json(result);
    }),
);

export { router as adminRouter };
