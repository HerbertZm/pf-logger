import { Router, Request, Response } from 'express';
import { getAppConfig } from '../services/appConfig';

const router = Router();

// GET /api/config — authenticated ops settings for client display logic
router.get('/config', (_req: Request, res: Response) => {
    const config = getAppConfig();
    res.json({
        extensionLogisticsThresholdMin: config.extensionLogisticsThresholdMin,
    });
});

export { router as configRouter };
