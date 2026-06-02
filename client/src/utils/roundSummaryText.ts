import type { RoundSummary, Tournament } from '../api/types';
import { formatInTournamentTz } from './time';

const val = (n: number | null | undefined): string => {
    if (n === null || n === undefined || n === 0) return '0';
    return String(n);
};

export function formatRoundSummaryText(summary: RoundSummary, tournament: Tournament | null): string {
    const tz = tournament?.timezone ?? 'America/New_York';
    const r = summary.round;
    const lines: string[] = [];
    const title = tournament !== null ? `${tournament.name} — ` : '';
    lines.push(`${title}Round ${r.roundNumber} (${r.phase})`);
    lines.push(`Status: ${r.cardeStatus ?? '—'}`);
    if (r.startedAt !== null) {
        lines.push(
            `Started: ${formatInTournamentTz(r.startedAt, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
        );
    }
    if (r.timerEndDatetime !== null) {
        lines.push(
            `Timer end: ${formatInTournamentTz(r.timerEndDatetime, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
        );
    }
    lines.push(`Drops: ${val(summary.dropCount)} · Extensions: ${val(summary.extensionCount)} · Penalties: ${val(summary.penaltyCount)}`);
    lines.push(`Late tables at time called: ${val(summary.outstandingAtTimeCalled)}`);
    if (summary.round.missingTablesJson !== null && summary.round.missingTablesJson.length > 0) {
        lines.push(`Tables: ${summary.round.missingTablesJson.join(', ')}`);
    }
    if (r.operatorNotes !== null && r.operatorNotes.length > 0) {
        lines.push(`Notes: ${r.operatorNotes}`);
    }
    return lines.join('\n');
}
