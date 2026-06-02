import type { Tournament } from './types';

export interface AppEventSummary {
    id: number;
    name: string;
    shortName: string;
    timezone: string;
    venue: string | null;
    isActive: boolean;
    tournamentCount: number;
}

export interface HealthStatusResponse {
    ok: boolean;
    uptime: number;
    db: 'ok' | 'error';
    pfJwt: {
        inMemory: boolean;
        expiresAt: string | null;
        setBy: string | null;
        expired: boolean;
    };
    tournaments: Array<{
        tournamentId: number;
        name: string;
        isRunning: boolean;
        lastError: string | null;
        lastRoundsFetchedAt: string | null;
        lastMatchesFetchedAt: string | null;
        lastPfFetchedAt: string | null;
    }>;
}

export interface AdminUser {
    id: number;
    username: string;
    role: string;
    isActive: boolean;
    createdAt?: string;
    /** Latest session `created_at` for this username (proxy for last login). */
    lastLoginAt?: string | null;
}

export interface AdminSession {
    id: number;
    username: string;
    createdAt: string;
    expiresAt: string;
    ip: string | null;
    userAgent: string | null;
}

export interface AdminSourceMapping {
    source: string;
    externalId: string;
    isEnabled: boolean;
}

export type AdminTournament = Tournament & {
    createdAt?: string;
    deletedAt?: string | null;
    sourceMappings: AdminSourceMapping[];
};

export interface SourceMapping {
    tournamentId: number;
    source: string;
    externalId: string;
    isEnabled: boolean;
}
