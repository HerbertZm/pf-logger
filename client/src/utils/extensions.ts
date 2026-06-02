import type { Extension } from '../api/types';

export function isLogisticsExtension(ext: Extension, thresholdMin: number): boolean {
    const mins = ext.extensionMinutes ?? 0;
    return mins >= thresholdMin;
}

export function splitExtensions(
    extensions: Extension[],
    thresholdMin: number,
): { operational: Extension[]; logistics: Extension[] } {
    const operational: Extension[] = [];
    const logistics: Extension[] = [];
    for (const ext of extensions) {
        if (isLogisticsExtension(ext, thresholdMin)) {
            logistics.push(ext);
        } else {
            operational.push(ext);
        }
    }
    return { operational, logistics };
}

export function operationalExtensionCount(extensions: Extension[], thresholdMin: number): number {
    return splitExtensions(extensions, thresholdMin).operational.length;
}
