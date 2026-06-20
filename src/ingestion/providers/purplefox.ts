/** PurpleFox / Supabase fetcher.
 * See agent/PURPLEFOX.md for full API surface documentation.
 * See docs/pf-api.md for quick reference (auth, read/write patterns, gotchas).
 *
 * Key invariants:
 * - PF users are staff (judges/scorekeepers), not players
 * - Extensions live in tournament_logs table (not a general activity log)
 * - Penalties table is "tournament_penalities" (extra 'i' — typo in PF schema; keep as-is)
 * - tournament_logs.round is a direct column — no timestamp inference needed
 * - tables, table_status, tournament_time are current-round-only — wiped on round advance
 * - PF uses camelCase for most fields; some columns (updated_by, creator_id, etc.) are snake_case
 */

import { createClient } from '@supabase/supabase-js';

function getSupabase(jwt: string): ReturnType<typeof createClient> {
    const url = process.env['SUPABASE_URL'] ?? '';
    const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
    // anon key goes in the apikey header; JWT goes in Authorization: Bearer
    return createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
}

// ─── PF data shapes ────────────────────────────────────────────────────────────

export interface PfProfile {
    id: string; // Supabase auth UUID
    firstname: string | null;
    lastname: string | null;
}

// ─── Staff profiles fetch ──────────────────────────────────────────────────────

const PROFILES_PAGE_SIZE = 1000;

/**
 * Fetch all PurpleFox staff profiles with pagination.
 * The profiles table is global (not per-tournament) and contains ~2k rows.
 * Uses the provided staff JWT; anon key alone is insufficient.
 */
export async function fetchPfProfiles(jwt: string): Promise<PfProfile[]> {
    const sb = getSupabase(jwt);
    const all: PfProfile[] = [];
    let from = 0;
    let pageLength = PROFILES_PAGE_SIZE;

    while (pageLength === PROFILES_PAGE_SIZE) {
        const { data, error } = await sb
            .from('profiles')
            .select('id,firstname,lastname')
            .range(from, from + PROFILES_PAGE_SIZE - 1)
            .order('firstname');

        if (error) throw new Error(`PF profiles fetch failed: ${error.message}`);
        if (!data || data.length === 0) break;

        all.push(...(data as PfProfile[]));
        pageLength = data.length;
        if (pageLength < PROFILES_PAGE_SIZE) break;
        from += PROFILES_PAGE_SIZE;
    }

    return all;
}

// ─── PF event data shapes (snake_case matches actual API response) ─────────────

export interface PfDrop {
    tournamentId: string;
    playerGameId: string;
    tableNumber: number | null;
    round: number | null;
    playerName: string | null;
    isChecked: boolean;
    isCancelled: boolean;
    updated_by: string | null; // UUID; snake_case is intentional (PF schema)
    updated_by_name: string | null; // display name string; snake_case is intentional
}

export interface PfPenalty {
    id: string; // UUID
    round: number | null;
    playerGameId: string | null;
    playerName: string | null;
    type: string | null; // infraction category — PF field name is "type"
    sanction: string | null;
    description: string | null;
    creator_id: string | null; // UUID; snake_case is intentional
    creator_name: string | null; // display name string; snake_case is intentional
    createdAt: string; // ISO 8601 WITHOUT timezone suffix — treat as UTC
}

export interface PfExtension {
    id: number; // PF auto-increment integer (tournament_logs.id)
    tableNumber: number;
    round: number | null; // direct column — no timestamp inference needed
    action: string; // "Change time from Xmin to Ymin"
    userId: string | null; // PF staff UUID (FK to profiles.id)
    createdAt: string; // UTC with +00:00 suffix
}

export interface PfJudgeCall {
    tableNumber: number;
    judgeResult: string; // free-text — not an enum
    coveredBy: string | null; // judge who handled the call; stored as judge on TableJudgeCall
}

export interface PfCoverage {
    tableNumber: number;
    coveredBy: string; // judge who seated at the table
}

export interface PfData {
    drops: PfDrop[];
    penalties: PfPenalty[];
    extensions: PfExtension[];
    judgeCalls: PfJudgeCall[];
    coverage: PfCoverage[];
    currentRound: number | null; // from tournaments.round; used to annotate judge calls
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

/** Fetch current round number from PF tournaments table. */
async function fetchCurrentRound(pfTournamentId: string, jwt: string): Promise<number | null> {
    const sb = getSupabase(jwt);
    const { data, error } = await sb.from('tournaments').select('round').eq('id', pfTournamentId).single();
    if (error) throw new Error(`PF tournaments fetch failed: ${error.message}`);
    return (data as { round: number | null } | null)?.round ?? null;
}

export async function fetchPfData(pfTournamentId: string, jwt: string): Promise<PfData> {
    const sb = getSupabase(jwt);

    const [dropsRes, penaltiesRes, extensionsRes, judgeCallsRes, coverageRes, currentRound] = await Promise.all([
        sb
            .from('tournament_drops')
            .select(
                'tournamentId,playerGameId,tableNumber,round,playerName,isChecked,isCancelled,updated_by,updated_by_name',
            )
            .eq('tournamentId', pfTournamentId),

        sb
            .from('tournament_penalities') // typo is intentional — correct spelling returns 404
            .select('id,round,playerGameId,playerName,type,sanction,description,creator_id,creator_name,createdAt')
            .eq('tournamentId', pfTournamentId),

        sb
            .from('tournament_logs')
            .select('id,tableNumber,round,action,userId,createdAt')
            .eq('tournamentId', pfTournamentId)
            .like('action', 'Change%'), // only extension entries

        // Judge calls: tables with a submitted result this round
        sb
            .from('tables')
            .select('tableNumber,judgeResult,coveredBy')
            .eq('tournamentId', pfTournamentId)
            .not('judgeResult', 'is', null)
            .neq('judgeResult', ''),

        // Coverage: tables where a judge has seated (coveredBy set), regardless of result
        sb
            .from('tables')
            .select('tableNumber,coveredBy')
            .eq('tournamentId', pfTournamentId)
            .not('coveredBy', 'is', null)
            .neq('coveredBy', ''),

        fetchCurrentRound(pfTournamentId, jwt),
    ]);

    if (dropsRes.error) throw new Error(`PF drops fetch failed: ${dropsRes.error.message}`);
    if (penaltiesRes.error) throw new Error(`PF penalties fetch failed: ${penaltiesRes.error.message}`);
    if (extensionsRes.error) throw new Error(`PF extensions fetch failed: ${extensionsRes.error.message}`);
    if (judgeCallsRes.error) throw new Error(`PF judge calls fetch failed: ${judgeCallsRes.error.message}`);
    if (coverageRes.error) throw new Error(`PF coverage fetch failed: ${coverageRes.error.message}`);

    return {
        drops: dropsRes.data,
        penalties: penaltiesRes.data,
        extensions: extensionsRes.data,
        judgeCalls: judgeCallsRes.data,
        coverage: coverageRes.data,
        currentRound,
    };
}

/** Parse "Change time from Xmin to Ymin" action string from tournament_logs.
 *  Values are in MINUTES (confirmed from live data — "5min" = 5 actual minutes).
 *  Returned as fromMinutes/toMinutes to match DB column names; delta = toMinutes - fromMinutes. */
export function parseExtensionAction(action: string): {
    fromMinutes: number | null; // raw seconds despite the name
    toMinutes: number | null;   // raw seconds despite the name
} {
    const match = /from\s+(\d+)min\s+to\s+(\d+)min/i.exec(action);
    if (!match) return { fromMinutes: null, toMinutes: null };
    return { fromMinutes: Number(match[1]), toMinutes: Number(match[2]) };
}
