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
 */

import { createClient } from '@supabase/supabase-js';

function getSupabase(jwt: string) {
  const url = process.env['SUPABASE_URL'] ?? '';
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
  // anon key goes in the apikey header; JWT goes in Authorization: Bearer
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export interface PfDrop {
  id: string;
  player_game_id: string;
  round: number | null;
  table_number: number | null;
  player_name: string | null;
  is_checked: boolean;
  is_cancelled: boolean;
  updated_by: string | null;
}

export interface PfPenalty {
  id: string;
  round: number | null;
  player_game_id: string | null;
  player_name: string | null;
  description: string | null;
  infraction: string | null;
  sanction: string | null;
  created_at: string;
  creator_id: string | null;
  creator_name: string | null;
}

export interface PfExtension {
  id: number;          // PF auto-increment integer (tournament_logs.id)
  table_number: number;
  round: number | null; // direct column — no timestamp inference needed
  action: string;       // "Change time from Xmin to Ymin"
  user_id: string | null;
  created_at: string;   // UTC with +00:00 suffix
}

export interface PfCoverage {
  id: string;
  table_number: number;
  covered_by: string;
  first_seen_at: string;
}

export interface PfJudgeCall {
  id: string;
  table_number: number;
  round: number | null;
  judge: string | null;
  judge_result: string;
  first_seen_at: string;
}

export interface PfData {
  drops: PfDrop[];
  penalties: PfPenalty[];
  extensions: PfExtension[];
  coverage: PfCoverage[];
  judgeCalls: PfJudgeCall[];
}

export async function fetchPfData(pfTournamentId: string, jwt: string): Promise<PfData> {
  const sb = getSupabase(jwt);

  // TODO: P0.4 — implement with actual PF table/column names verified in P0.1
  // Note: penalties table is "tournament_penalities" (typo in PF schema)
  const [drops, penalties, extensions] = await Promise.all([
    sb.from('tournament_drops').select('*').eq('tournament_id', pfTournamentId),
    sb.from('tournament_penalities').select('*').eq('tournament_id', pfTournamentId),
    sb.from('tournament_logs').select('*').eq('tournament_id', pfTournamentId),
  ]);

  if (drops.error) throw new Error(`PF drops fetch failed: ${drops.error.message}`);
  if (penalties.error) throw new Error(`PF penalties fetch failed: ${penalties.error.message}`);
  if (extensions.error) throw new Error(`PF extensions fetch failed: ${extensions.error.message}`);

  return {
    drops: drops.data as PfDrop[],
    penalties: penalties.data as PfPenalty[],
    extensions: extensions.data as PfExtension[],
    coverage: [],
    judgeCalls: [],
  };
}

/** Parse "Change time from Xmin to Ymin" action string from tournament_logs. */
export function parseExtensionAction(
  action: string,
): { fromMinutes: number | null; toMinutes: number | null } {
  const match = /from\s+(\d+)min\s+to\s+(\d+)min/i.exec(action);
  if (!match) return { fromMinutes: null, toMinutes: null };
  return { fromMinutes: Number(match[1]), toMinutes: Number(match[2]) };
}
