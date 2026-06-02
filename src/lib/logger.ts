type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

function currentLevel(): LogLevel {
    const raw = process.env['LOG_LEVEL']?.toLowerCase();
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
        return raw;
    }
    return process.env['NODE_ENV'] === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel()];
}

function write(level: LogLevel, message: string, meta?: unknown): void {
    if (!shouldLog(level)) return;
    const prefix = `[pf-logger] ${level}:`;
    if (meta !== undefined) {
        console.warn(prefix, message, meta);
    } else {
        console.warn(prefix, message);
    }
}

export const logger = {
    debug: (message: string, meta?: unknown): void => write('debug', message, meta),
    info: (message: string, meta?: unknown): void => write('info', message, meta),
    warn: (message: string, meta?: unknown): void => write('warn', message, meta),
    error: (message: string, meta?: unknown): void => write('error', message, meta),
};
