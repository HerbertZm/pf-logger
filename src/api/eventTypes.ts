/** Admin event API shapes — mirrored in client/src/api/adminTypes.ts */

export interface AppEventSummary {
    id: number;
    name: string;
    shortName: string;
    timezone: string;
    venue: string | null;
    isActive: boolean;
    tournamentCount: number;
}

export interface AppEventNested {
    id: number;
    name: string;
    shortName: string;
    timezone: string;
}
