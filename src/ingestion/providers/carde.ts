/** Carde.io API fetcher.
 * See agent/CARDE_IO.md for full API surface documentation.
 * See docs/carde-api.md for quick reference (auth, read/write patterns, gotchas).
 *
 * Key invariants:
 * - Always fetch matches with status=in_progress + page_size=200 — never the full match list
 * - Round objects have NO extra_time_seconds or additional_time_seconds field — these do not exist
 * - completed_at for Swiss rounds equals the next round's started_at; never use for duration
 * - timer_end_datetime lives on detail/ endpoint only; compute locally as started_at + (duration * 60s)
 * - timer_is_running does NOT flip false on expiry; detect via timer_end_datetime vs wall time
 */

import { getCardeToken } from '../cardeTokenStore';

const BASE = 'https://api.admin.carde.io/api';

interface CardeRound {
    id: number;
    round_number: number;
    started_at: string | null;
    completed_at: string | null; // equals next round's started_at for Swiss; never use for duration
    timer_duration_minutes: number | null; // NULL for Top-8 and until timer is explicitly set
    status: string; // UPCOMING | IN_PROGRESS | COMPLETE
    pairings_status: string | null;
    standings_status: string | null;
}

interface CardeMatch {
    id: number;
    table_number: number;
    status: string;
    time_extension_seconds: number;
    is_ghost_match: boolean;
    is_bye: boolean;
    match_is_loss: boolean;
    match_is_intentional_draw: boolean;
    match_is_unintentional_draw: boolean;
    deck_check_started: boolean;
    deck_check_completed: boolean;
    assigned_judge: string | null;
    result_reported_at: string | null;
    updated_at: string;
    p1_user_id: string | null;
    p1_name: string | null;
    p2_user_id: string | null;
    p2_name: string | null;
    winning_player_id: string | null;
}

async function cardeGet<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Token ${getCardeToken()}` },
    });
    if (!res.ok) {
        throw new Error(`Carde API ${res.status} at ${path}`);
    }
    return res.json() as Promise<T>;
}

export async function fetchCardeRounds(cardeEventId: number): Promise<CardeRound[]> {
    const data = await cardeGet<{ results?: CardeRound[] } | CardeRound[]>(
        `/magic-events/${cardeEventId}/get_all_rounds/`,
    );
    return Array.isArray(data) ? data : (data.results ?? []);
}

export async function fetchCardeMatches(cardeRoundId: number): Promise<CardeMatch[]> {
    // status=in_progress confirmed functional; page_size=200 to get all in one call (default is 25)
    const data = await cardeGet<{ results?: CardeMatch[] } | CardeMatch[]>(
        `/v2/organize/tournament-rounds/${cardeRoundId}/matches-list/?status=in_progress&avoid_cache=true&page_size=200`,
    );
    return Array.isArray(data) ? data : (data.results ?? []);
}
