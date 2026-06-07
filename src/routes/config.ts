import { Router, Request, Response } from 'express';
import { getAppConfig } from '../services/appConfig';

const router = Router();

// GET /api/config — auth-gated (whole app requires auth; intentional, not public)
//   Returns settings the client needs for display logic (logistics threshold).
router.get('/config', (_req: Request, res: Response) => {
    const config = getAppConfig();
    res.json({
        extensionLogisticsThresholdMin: config.extensionLogisticsThresholdMin,
    });
});

export { router as configRouter };
