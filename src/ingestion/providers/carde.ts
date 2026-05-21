/** Carde.io API fetcher.
 * See agent/CARDE_IO.md for full API surface documentation.
 *
 * Key invariants:
 * - Always fetch matches with status=in_progress — never the full match list
 * - API may return "extra_time_seconds" or "additional_time_seconds" — check both
 * - completed_at for Swiss rounds equals the next round's started_at; never use for duration
 * - timer_end_datetime is NOT present in completed event responses; always compute locally
 */

const BASE = 'https://app.carde.io/api';
const TOKEN = process.env['CARDE_API_TOKEN'] ?? '';

interface CardeRound {
  id: number;
  round_number: number;
  started_at: string | null;
  completed_at: string | null;
  timer_duration_minutes: number | null;
  extra_time_seconds?: number;
  additional_time_seconds?: number; // alternate key name seen in some responses
  status: string;
  pairings_status: string | null;
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
    headers: { Authorization: `Token ${TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Carde API ${res.status} at ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchCardeRounds(cardeEventId: number): Promise<CardeRound[]> {
  // TODO: P0.4 — confirm exact response envelope shape from P0.1 exploration
  const data = await cardeGet<{ results?: CardeRound[] } | CardeRound[]>(
    `/magic-events/${cardeEventId}/get_all_rounds/`,
  );
  return Array.isArray(data) ? data : (data.results ?? []);
}

export async function fetchCardeMatches(
  cardeRoundId: number,
): Promise<CardeMatch[]> {
  // status=in_progress confirmed functional — never fetch full match list
  const data = await cardeGet<{ results?: CardeMatch[] } | CardeMatch[]>(
    `/v2/organize/tournament-rounds/${cardeRoundId}/matches-list/?status=in_progress&avoid_cache=true`,
  );
  return Array.isArray(data) ? data : (data.results ?? []);
}

/** Normalize the extra time field regardless of which key the API used. */
export function getExtraTimeSeconds(round: CardeRound): number {
  return round.extra_time_seconds ?? round.additional_time_seconds ?? 0;
}
