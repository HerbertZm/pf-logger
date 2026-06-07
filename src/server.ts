import 'dotenv/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { tournamentsRouter } from './routes/tournaments';
import { sessionRouter } from './routes/session';
import { syncRouter } from './routes/sync';
import { adminRouter } from './routes/admin';
import { reportsRouter } from './routes/reports';
import { configRouter } from './routes/config';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { startWorker } from './ingestion/worker';
import { buildPublicHealthStatus } from './services/healthStatus';
import { loadAppConfig } from './services/appConfig';
import { logger } from './lib/logger';

const app = express();
const PORT = Number(process.env['PORT'] ?? 8080);

app.use(express.json());
app.use(rateLimitMiddleware);

// GET /api/health — must be before authMiddleware mounts so it is always public
app.get('/api/health', async (_req: Request, res: Response) => {
    const status = await buildPublicHealthStatus(Math.floor(process.uptime()));
    res.status(status.ok ? 200 : 503).json(status);
});

// Public routes (login, logout, /me)
app.use('/api', sessionRouter);

// Authenticated routes
app.use('/api', authMiddleware, tournamentsRouter);
app.use('/api', authMiddleware, configRouter);
app.use('/api', authMiddleware, syncRouter);
app.use('/api/reports', authMiddleware, reportsRouter);
app.use('/api/admin', authMiddleware, adminRouter);

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
    logger.error('unhandled error', err);
    res.status(500).json({ error: 'Internal server error' });
});

void loadAppConfig().then(() => {
    if (process.env['NODE_ENV'] === 'production' && (process.env['PF_PASSWORD_PEPPER'] ?? '').trim() === '') {
        logger.error('PF_PASSWORD_PEPPER is required when NODE_ENV=production');
        process.exit(1);
    }

    app.listen(PORT, () => {
        logger.info(`running on port ${PORT} [${process.env['NODE_ENV'] ?? 'development'}]`);
        startWorker().catch((err) => {
            logger.error('worker failed to start on boot', err);
        });
    });
});

export default app;
