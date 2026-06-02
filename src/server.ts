import 'dotenv/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { tournamentsRouter } from './routes/tournaments';
import { sessionRouter } from './routes/session';
import { syncRouter } from './routes/sync';
import { adminRouter } from './routes/admin';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { startWorker } from './ingestion/worker';
import { prisma } from './db/prisma';

const app = express();
const PORT = Number(process.env['PORT'] ?? 8080);

app.use(express.json());
app.use(rateLimitMiddleware);

// Public routes (login, logout, /me)
app.use('/api', sessionRouter);

// Authenticated routes
app.use('/api', authMiddleware, tournamentsRouter);
app.use('/api', authMiddleware, syncRouter);
app.use('/api/admin', authMiddleware, adminRouter);

// GET /api/health — unauthenticated liveness + readiness probe
app.get('/api/health', async (_req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ ok: true, uptime: Math.floor(process.uptime()), db: 'ok' });
    } catch {
        res.status(503).json({ ok: false, uptime: Math.floor(process.uptime()), db: 'error' });
    }
});

// Unmatched /api/* → 404 (prevents SPA fallback from swallowing API typos)
app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
});

// Serve React SPA in production
if (process.env['NODE_ENV'] === 'production') {
    const clientDist = path.join(__dirname, '..', 'dist', 'client');
    app.use(express.static(clientDist));
    app.get(/(.*)/, (_req, res) => {
        res.sendFile(path.join(clientDist, 'index.html'));
    });
}

// Global error handler — catches anything forwarded via next(err) from asyncHandler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.warn(`pf-logger running on port ${PORT} [${process.env['NODE_ENV'] ?? 'development'}]`);
    // Start background ingestion worker for all active tournaments.
    // Crash here does not take down the HTTP server.
    startWorker().catch((err) => {
        console.error('[worker] failed to start on boot:', err);
    });
});

export default app;
