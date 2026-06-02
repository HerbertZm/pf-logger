import { prisma } from '../db/prisma';

export interface AppConfigValues {
    cardePollIntervalMs: number;
    pfPollIntervalMs: number;
    extensionLogisticsThresholdMin: number;
}

const DEFAULTS: AppConfigValues = {
    cardePollIntervalMs: 30_000,
    pfPollIntervalMs: 15_000,
    extensionLogisticsThresholdMin: 50,
};

const MIN_POLL_MS = 5_000;
const MAX_POLL_MS = 300_000;
const MIN_LOGISTICS = 1;
const MAX_LOGISTICS = 180;

let cached: AppConfigValues = { ...DEFAULTS };

export function getAppConfig(): AppConfigValues {
    return { ...cached };
}

export async function loadAppConfig(): Promise<AppConfigValues> {
    await ensureAppConfigRow();
    const row = await prisma.appConfig.findUnique({ where: { id: 1 } });
    if (row === null) {
        cached = { ...DEFAULTS };
        return getAppConfig();
    }
    cached = {
        cardePollIntervalMs: row.cardePollIntervalMs,
        pfPollIntervalMs: row.pfPollIntervalMs,
        extensionLogisticsThresholdMin: row.extensionLogisticsThresholdMin,
    };
    return getAppConfig();
}

export function validateAppConfigPatch(patch: Partial<AppConfigValues>): string | null {
    if (patch.cardePollIntervalMs !== undefined) {
        if (patch.cardePollIntervalMs < MIN_POLL_MS || patch.cardePollIntervalMs > MAX_POLL_MS) {
            return `cardePollIntervalMs must be ${MIN_POLL_MS}–${MAX_POLL_MS}`;
        }
    }
    if (patch.pfPollIntervalMs !== undefined) {
        if (patch.pfPollIntervalMs < MIN_POLL_MS || patch.pfPollIntervalMs > MAX_POLL_MS) {
            return `pfPollIntervalMs must be ${MIN_POLL_MS}–${MAX_POLL_MS}`;
        }
    }
    if (patch.extensionLogisticsThresholdMin !== undefined) {
        if (
            patch.extensionLogisticsThresholdMin < MIN_LOGISTICS ||
            patch.extensionLogisticsThresholdMin > MAX_LOGISTICS
        ) {
            return `extensionLogisticsThresholdMin must be ${MIN_LOGISTICS}–${MAX_LOGISTICS}`;
        }
    }
    return null;
}

export async function updateAppConfig(patch: Partial<AppConfigValues>): Promise<AppConfigValues> {
    const err = validateAppConfigPatch(patch);
    if (err !== null) {
        throw new Error(err);
    }
    const row = await prisma.appConfig.upsert({
        where: { id: 1 },
        create: {
            id: 1,
            cardePollIntervalMs: patch.cardePollIntervalMs ?? DEFAULTS.cardePollIntervalMs,
            pfPollIntervalMs: patch.pfPollIntervalMs ?? DEFAULTS.pfPollIntervalMs,
            extensionLogisticsThresholdMin:
                patch.extensionLogisticsThresholdMin ?? DEFAULTS.extensionLogisticsThresholdMin,
        },
        update: {
            ...(patch.cardePollIntervalMs !== undefined && { cardePollIntervalMs: patch.cardePollIntervalMs }),
            ...(patch.pfPollIntervalMs !== undefined && { pfPollIntervalMs: patch.pfPollIntervalMs }),
            ...(patch.extensionLogisticsThresholdMin !== undefined && {
                extensionLogisticsThresholdMin: patch.extensionLogisticsThresholdMin,
            }),
        },
    });
    cached = {
        cardePollIntervalMs: row.cardePollIntervalMs,
        pfPollIntervalMs: row.pfPollIntervalMs,
        extensionLogisticsThresholdMin: row.extensionLogisticsThresholdMin,
    };
    if (patch.cardePollIntervalMs !== undefined || patch.pfPollIntervalMs !== undefined) {
        void import('../ingestion/worker').then((m) => {
            m.rescheduleActiveTournamentPolls();
        });
    }
    return getAppConfig();
}

export async function ensureAppConfigRow(): Promise<void> {
    await prisma.appConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...DEFAULTS },
        update: {},
    });
}
