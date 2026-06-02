import type { Request } from 'express';
import { prisma } from '../db/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

export type AuditEventType =
    | 'tournament_created'
    | 'tournament_updated'
    | 'tournament_deactivated'
    | 'tournament_ended'
    | 'event_created'
    | 'event_updated'
    | 'event_deactivated'
    | 'event_timezone_cascaded'
    | 'source_toggled'
    | 'user_created'
    | 'user_updated'
    | 'user_password_reset'
    | 'user_deactivated'
    | 'session_revoked'
    | 'login'
    | 'login_failed'
    | 'logout'
    | 'pf_jwt_set'
    | 'pf_jwt_cleared'
    | 'config_updated'
    | 'test_tournament_reset'
    | 'manual_sync'
    | 'tournament_backfill'
    | 'staff_sync';

interface LogActivityParams {
    eventType: AuditEventType;
    username: string;
    ip?: string | null;
    userAgent?: string | null;
    detail?: string | null;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
    await prisma.appActivity.create({
        data: {
            eventType: params.eventType,
            username: params.username,
            ip: params.ip ?? null,
            userAgent: params.userAgent ?? null,
            detail: params.detail ?? null,
        },
    });
}

export function auditFromRequest(
    req: Request,
    eventType: AuditEventType,
    detail?: string | null,
): Promise<void> {
    const user = (req as AuthenticatedRequest).user;
    return logActivity({
        eventType,
        username: user?.username ?? 'system',
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        detail: detail ?? null,
    });
}

export function auditPublicRequest(
    req: Request,
    eventType: AuditEventType,
    username: string,
    detail?: string | null,
): Promise<void> {
    return logActivity({
        eventType,
        username,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        detail: detail ?? null,
    });
}
